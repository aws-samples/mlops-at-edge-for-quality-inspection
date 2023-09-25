import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import { aws_iam as iam, aws_lambda as lambda, CfnOutput, Duration, Stack } from 'aws-cdk-lib';
import { Architecture, DockerImageFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as path from "path";
import { StateMachinePipelineProps } from '../stacks/statemachine-pipeline';



/**
 * Construct to create all supporting artifacts required for StepFunction exexution
 */
export class PipelineAssets extends Construct {

  public readonly pipeline_role: CfnOutput;
  public readonly labeling_job_lambda: lambda_python.PythonFunction;
  public readonly verification_job_lambda: lambda_python.PythonFunction;
  public readonly check_missing_labels_lambda: DockerImageFunction;
  public readonly update_feature_store_lambda: lambda_python.PythonFunction;


  constructor(scope: Construct, id: string, props: StateMachinePipelineProps) {
    super(scope, id);

    // create execution role for stepfunction pipeline
    const pipeline_role = this.createExecutionRole(props)
    // create lambda which checks for missing labels
    this.check_missing_labels_lambda = this.createMissingLabelsLambda(props, pipeline_role)
    //create lambda function for SM Ground Truth verification job
    this.verification_job_lambda = this.createRunVerificationJobLambda(props, pipeline_role)
    //create lambda function for SM Ground Truth labeling job
    this.labeling_job_lambda = this.createRunLabelingJobLambda(props, pipeline_role)
    // create lambda which updates labels in feature store
    this.update_feature_store_lambda = this.updateFeatureStoreLambda(props, pipeline_role)
  }

  createExecutionRole(props: StateMachinePipelineProps) {
    const pipelineRole = new iam.Role(this, 'StepFunctionsExecutionRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('sagemaker.amazonaws.com'),
        new iam.ServicePrincipal('lambda.amazonaws.com')
      )
    });



    pipelineRole.addToPolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: [ 'sagemaker:DescribeLabelingJob', 'cloudwatch:DescribeLogStreams', 'cloudwatch:CreateLogGroup', 'cloudwatch:CreateLogStream', 'logs:PutLogEvents', 'states:StartExecution'],
    }));

    pipelineRole.addToPolicy(new iam.PolicyStatement({
      resources: [`arn:aws:s3:::${props.assetsBucket}`, `arn:aws:s3:::${props.assetsBucket}/*`],
      actions: ['s3:*'],
    }));

    pipelineRole.addManagedPolicy( iam.ManagedPolicy.fromManagedPolicyArn(this,'S3ReadOnlyPolicy', 'arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess'))

    pipelineRole.addToPolicy(new iam.PolicyStatement({
      resources: [`arn:aws:athena:${Stack.of(this).region}:${Stack.of(this).account}:workgroup/primary`],
      actions: ['athena:StartQueryExecution', 'athena:GetQueryExecution', 'athena:GetQueryResults', 'athena:StopQueryExecution', 'athena:GetWorkGroup']
    }));

    pipelineRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'))
    //pipelineRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'))
    pipelineRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'))

    return pipelineRole;
  }

  updateFeatureStoreLambda(props: StateMachinePipelineProps, role: iam.Role) {
    return new lambda.DockerImageFunction(this, 'UpdateFeatureStoreLambda', {
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '../lambda/update_feature_store')),
      architecture: Architecture.X86_64,
      functionName: "UpdateLabelsInFeatureStoreFunction",
      memorySize: 1024,
      timeout: Duration.seconds(600),
      role: role,
      environment: {
        "ROLE": role.roleArn,
        "FEATURE_GROUP_NAME": props.featureGroupName,
        "FEATURE_NAME_S3URI": "source_ref",
        "FEATURE_STORE_S3URI": `s3://${props.assetsBucket}/feature-store/`,
        "QUERY_RESULTS_S3URI": `s3://${props.assetsBucket}/tmp/feature_store_query_results`,
      }
    });

  }

  createMissingLabelsLambda(props: StateMachinePipelineProps, role: iam.Role) {
    const missingLabelsLambda = new lambda.DockerImageFunction(this, 'CheckMissingLabelsFunction', {
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '../lambda/check_missing_labels')),
      architecture: Architecture.X86_64,
      functionName: "CheckMissingLabelsFunction",
      memorySize: 1024,
      role: role,
      timeout: Duration.seconds(300),
      environment: {
        "FEATURE_GROUP_NAME": props.featureGroupName,
        "FEATURE_NAME_S3URI": "source_ref",
        "INPUT_IMAGES_S3URI": `s3://${props.assetsBucket}/pipeline/assets/images/`,
        "QUERY_RESULTS_S3URI": `s3://${props.assetsBucket}/tmp/feature_store_query_results`,
      }
    });


    return missingLabelsLambda
  }

  createRunLabelingJobLambda(props: StateMachinePipelineProps, role: iam.Role) {
    return new lambda_python.PythonFunction(this, 'RunLabelingJobLambda', {
      entry: 'lib/lambda/run_labeling_job', // required
      runtime: lambda.Runtime.PYTHON_3_11,
      architecture: Architecture.X86_64,
      timeout: Duration.seconds(300),
      role: role,
      environment: {
        "BUCKET": props.assetsBucket,
        "PREFIX": "pipeline/assets",
        "ROLE": role.roleArn,
        "USE_PRIVATE_WORKTEAM": String(props.usePrivateWorkteamForLabeling),
        "PRIVATE_WORKTEAM_ARN": props.labelingJobPrivateWorkteamArn,
        "MAX_LABELS": props.maxLabelsPerLabelingJob.toString()
      }
    });

  }


  createRunVerificationJobLambda(props: StateMachinePipelineProps, role: iam.Role) {
    {
      return new lambda_python.PythonFunction(this, 'RunVerificationJobLambda', {
        entry: 'lib/lambda/run_verification_job', // required
        architecture: Architecture.X86_64,
        runtime: lambda.Runtime.PYTHON_3_11,
        timeout: Duration.seconds(300),
        role: role,
        environment: {
          "BUCKET": props.assetsBucket,
          "PREFIX": "pipeline/assets",
          "ROLE": role.roleArn,
          "USE_PRIVATE_WORKTEAM": String(props.usePrivateWorkteamForVerification),
          "PRIVATE_WORKTEAM_ARN": props.verificationJobPrivateWorkteamArn,
        }
      });


    }

  }
}
