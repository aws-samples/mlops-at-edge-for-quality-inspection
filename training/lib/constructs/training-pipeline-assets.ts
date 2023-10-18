import { aws_ecr_assets as ecr_assets, aws_iam as iam, CfnOutput, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import {AppConfig} from "../../bin/app";

export class TrainingPipelineAssets extends Construct {

  public readonly pipelineRole: CfnOutput;
  public readonly preprocessLambda: CfnOutput;
  public readonly preprocessImageURI: CfnOutput;

  constructor(scope: Construct, id: string, props: AppConfig) {
    super(scope, id);

    //build docker image for preprocessing container
    const asset = new ecr_assets.DockerImageAsset(this, 'PreprocessingImage', {
      directory: path.join(__dirname, '../assets/docker')
    });

    // outputs
    const stackName = `${Stack.of(this).stackName}`;
    this.preprocessImageURI = new CfnOutput(this, 'preprocessImageURI', {
      value: asset.imageUri,
      description: 'the processing image uri to be used for preprocessing',
      exportName: `${stackName}-preprocessImageURI`,
    });

    //role to be assumed by SageMaker Pipeline
    const pipelineRole = this.createSMPipeLineExecutionRole(props)

    // outputs
    this.pipelineRole = new CfnOutput(this, 'pipelineRole', {
      value: pipelineRole.roleArn,
      description: 'the role assumed when executing the sagemaker pipeline',
      exportName: `${stackName}-training-pipelineRole`,
    });
  }

  createSMPipeLineExecutionRole(props: AppConfig) {
    const pipelineRole = new iam.Role(this, 'SageMakerPipeLineRole', {
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
    });

    pipelineRole.addToPolicy(new iam.PolicyStatement({
      //TODO: Least privilege
      resources: [`arn:aws:s3:::${props.assetsBucket}`, `arn:aws:s3:::${props.assetsBucket}/*`],
      actions: ['s3:*'],
    }));

    //TODO: Least privilege
    pipelineRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'))
    return pipelineRole;
  }

}
