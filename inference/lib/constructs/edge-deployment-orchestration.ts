import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import {
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs, aws_stepfunctions as stepfunctions,
  Duration,
  Fn,
  Stack
} from 'aws-cdk-lib';
import { StateMachineInput, StepFunctionInvokeAction } from "aws-cdk-lib/aws-codepipeline-actions";
import { StateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from 'constructs';
import * as path from 'path';
import { AppConfig } from '../../bin/app'

export interface EdgeDeploymentOrchestrationConstructProps extends AppConfig{
  iotThingName: string;
}
export class EdgeDeploymentOrchestrationConstruct extends Construct {

  readonly stepFunctionName: string;
  readonly stepFunctionArn: string;
  readonly stepFunctionAction: StepFunctionInvokeAction;

  constructor(scope: Construct, id: string, props: EdgeDeploymentOrchestrationConstructProps) {
    super(scope, id);

    this.stepFunctionName = `EdgeDeploymentOrchestration-${Stack.of(this).stackName}`;

    const stepFunctionRole = new iam.Role(this, 'edge-packaging-sfn-exec-role', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambda_FullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSGreengrassFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSIoTFullAccess')
      ],
    });
    stepFunctionRole.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.ServicePrincipal('sagemaker.amazonaws.com'),
        ],
      }),
    );

    const lambdaRole = new iam.Role(this, 'edge-packaging-lambda-exec-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSGreengrassReadOnlyAccess'),
      ]
    });

    const findLatestComponentVersionFunction = new lambda_python.PythonFunction(this, 'LatestComponentVersion', {
      entry: path.join('lib', 'assets', 'gg_component_version_helper'),
      index: 'setup.py',
      runtime: lambda.Runtime.PYTHON_3_8,
      logRetention: logs.RetentionDays.ONE_DAY,
      role: lambdaRole,
      timeout: Duration.seconds(15),
      environment: {
        'SAGEMAKER_ROLE_ARN': stepFunctionRole.roleArn
      }
    });

    asl.States['Create Neo compilation job'].Parameters.RoleArn = stepFunctionRole.roleArn;
    asl.States['Create edge packaging job'].Parameters.RoleArn = stepFunctionRole.roleArn;
    asl.States['Find next greengrass component version'].Parameters.FunctionName = findLatestComponentVersionFunction.functionArn;
    asl.States['Find next greengrass component version'].Parameters.Payload.ComponentName = props.deploymentProps.ggModelComponentName;
    asl.States['Get Inference component version'].Parameters.FunctionName = findLatestComponentVersionFunction.functionArn;
    asl.States['Get Inference component version'].Parameters.Payload.ComponentName = props.deploymentProps.ggInferenceComponentName;
    asl.States['Get thing ARN'].Parameters.ThingName = props.iotThingName;
    asl.States['Create new deployment'].Parameters.Components['aws.greengrass.SageMakerEdgeManager'].ConfigurationUpdate.Merge = `{\"DeviceFleetName\":\"devicefleet\", \"BucketName\": \"${props.assetsBucket}\"}`

    const packageModelWorkflow = new stepfunctions.CfnStateMachine(this, 'EdgeDeploymentOrchestrationStepFunction', {
      roleArn: stepFunctionRole.roleArn,
      definitionString: JSON.stringify(asl),
      stateMachineName: this.stepFunctionName
    });

    const stepFunctionInput = {
      "ModelPackageGroupName": props.deploymentProps.smModelPackageGroupName,
      "s3OutputUriCompiledModel": `s3://${props.assetsBucket}/${props.pipelinePrefix}/pipeline/inference/output/compiled-model`, 
      "s3OutputUriPackagedModel": `s3://${props.assetsBucket}/${props.pipelinePrefix}/pipeline/inference/output/packaged-model` 
    }
    
    this.stepFunctionArn = `arn:aws:states:${Stack.of(this).region}:${Stack.of(this).account}:stateMachine:${this.stepFunctionName}`;
    
    this.stepFunctionAction = new StepFunctionInvokeAction({
      actionName: 'Invoke',
      stateMachine: StateMachine.fromStateMachineArn(this, 'state-machine-from-arn', this.stepFunctionArn),
      stateMachineInput: StateMachineInput.literal(stepFunctionInput)
    })
  }
}

// TODO:  Add native CDK definition
const asl = {
  "StartAt": "Find ARN of latest model package",
  "States": {
    "Find ARN of latest model package": {
      "Type": "Task",
      "Parameters": {
        "ModelPackageGroupName.$": "$.ModelPackageGroupName",
        "ModelApprovalStatus": "Approved",
        "SortBy": "CreationTime",
        "SortOrder": "Descending"
      },
      "Resource": "arn:aws:states:::aws-sdk:sagemaker:listModelPackages",
      "ResultSelector": {
        "ModelPackageArn.$": "$.ModelPackageSummaryList[0].ModelPackageArn"
      },
      "Next": "Find Name from model package ARN",
      "ResultPath": "$.previousOutput"
    },
    "Find Name from model package ARN": {
      "Type": "Task",
      "Next": "Create Neo compilation job",
      "Parameters": {
        "ModelPackageName.$": "$.previousOutput.ModelPackageArn"
      },
      "Resource": "arn:aws:states:::aws-sdk:sagemaker:describeModelPackage",
      "ResultSelector": {
        "ModelS3Uri.$": "$.InferenceSpecification.Containers[0].ModelDataUrl"
      },
      "ResultPath": "$.previousOutput"
    },
    "Create Neo compilation job": {
      "Type": "Task",
      "Parameters": {
        "CompilationJobName.$": "States.Format('compile-{}', $$.Execution.Name)",
        "InputConfig": {
          "DataInputConfig": "{'data':[1, 3, 300, 450]}",
          "Framework": "MXNET",
          "S3Uri.$": "$.previousOutput.ModelS3Uri"
        },
        "OutputConfig": {
          "TargetPlatform": {
            "Arch": "X86_64",
            "Os": "LINUX"
          },
          "S3OutputLocation.$": "$.s3OutputUriCompiledModel"
        },
        "RoleArn": "arn:aws:iam::343994789671:role/EdgeDeployment-EdgePackag-edgepackagingsfnexecrole-8ICO841DD2MQ",
        "StoppingCondition": {
          "MaxRuntimeInSeconds": 600
        }
      },
      "Resource": "arn:aws:states:::aws-sdk:sagemaker:createCompilationJob",
      "Next": "Wait for compilation to finish",
      "ResultPath": "$.previousOutput"
    },
    "Wait for compilation to finish": {
      "Type": "Wait",
      "Seconds": 30,
      "Next": "Fetch compilation status"
    },
    "Fetch compilation status": {
      "Type": "Task",
      "Parameters": {
        "CompilationJobName.$": "States.Format('compile-{}', $$.Execution.Name)"
      },
      "Resource": "arn:aws:states:::aws-sdk:sagemaker:describeCompilationJob",
      "Next": "Check compilation status",
      "ResultPath": "$.previousOutput"
    },
    "Check compilation status": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.previousOutput.CompilationJobStatus",
          "StringEquals": "COMPLETED",
          "Next": "Find next greengrass component version"
        },
        {
          "Variable": "$.previousOutput.CompilationJobStatus",
          "StringEquals": "FAILED",
          "Next": "Fail"
        }
      ],
      "Default": "Wait for compilation to finish"
    },
    "Find next greengrass component version": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "arn:aws:lambda:eu-west-1:343994789671:function:EdgeDeployment-EdgePackag-LatestComponentVersion5F-sOp22PmiH5W9",
        "Payload": {
          "ComponentName": "com.qualityinspection.model"
        }
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 6,
          "BackoffRate": 2
        }
      ],
      "Next": "Create edge packaging job",
      "ResultPath": "$.previousOutput"
    },
    "Create edge packaging job": {
      "Type": "Task",
      "Parameters": {
        "CompilationJobName.$": "States.Format('compile-{}', $$.Execution.Name)",
        "EdgePackagingJobName.$": "States.Format('packaging-{}', $$.Execution.Name)",
        "ModelName": "quality-inspection-model-edgemanager",
        "ModelVersion.$": "$.previousOutput.Payload.NextVersion",
        "OutputConfig": {
          "PresetDeploymentType": "GreengrassV2Component",
          "PresetDeploymentConfig": {
            "ComponentName": "com.qualityinspection.model",
            "ComponentVersion.$": "$.previousOutput.Payload.NextVersion"
          },
          "S3OutputLocation.$": "$.s3OutputUriPackagedModel"
        },
        "RoleArn": "arn:aws:iam::343994789671:role/EdgeDeployment-EdgePackag-edgepackagingsfnexecrole-8ICO841DD2MQ"
      },
      "Resource": "arn:aws:states:::aws-sdk:sagemaker:createEdgePackagingJob",
      "Next": "Wait for packaging to finish",
      "ResultPath": "$.previousOutput"
    },
    "Wait for packaging to finish": {
      "Type": "Wait",
      "Seconds": 15,
      "Next": "Fetch packaging status"
    },
    "Fetch packaging status": {
      "Type": "Task",
      "Parameters": {
        "EdgePackagingJobName.$": "States.Format('packaging-{}', $$.Execution.Name)"
      },
      "Resource": "arn:aws:states:::aws-sdk:sagemaker:describeEdgePackagingJob",
      "Next": "Check packaging status",
      "ResultPath": "$.previousOutput"
    },
    "Check packaging status": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.previousOutput.EdgePackagingJobStatus",
          "StringEquals": "COMPLETED",
          "Next": "Get thing ARN"
        },
        {
          "Variable": "$.previousOutput.EdgePackagingJobStatus",
          "StringEquals": "FAILED",
          "Next": "Fail"
        }
      ],
      "Default": "Wait for packaging to finish"
    },
    "Get thing ARN": {
      "Type": "Task",
      "Next": "Get Inference component version",
      "Parameters": {
        "ThingName": "EdgeThing-EdgeDeployment-GreengrassStack"
      },
      "Resource": "arn:aws:states:::aws-sdk:iot:describeThing",
      "ResultPath": "$.describeThingOutput"
    },
    "Get Inference component version": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "arn:aws:lambda:eu-west-1:343994789671:function:EdgeDeployment-EdgePackag-LatestComponentVersion5F-sOp22PmiH5W9",
        "Payload": {
          "ComponentName": "com.qualityinspection.model"
        }
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 6,
          "BackoffRate": 2
        }
      ],
      "Next": "Create new deployment",
      "ResultPath": "$.infererenceComponent"
    },
    "Create new deployment": {
      "Type": "Task",
      "Parameters": {
        "TargetArn.$": "$.describeThingOutput.ThingArn",
        "Components": {
          "aws.greengrass.Nucleus": {
            "ComponentVersion": "2.5.6"
          },
          "aws.greengrass.Cli": {
            "ComponentVersion": "2.5.6"
          },
          "aws.greengrass.SageMakerEdgeManager": {
            "ComponentVersion": "1.1.0",
            "ConfigurationUpdate": {
              "Merge": "{\"DeviceFleetName\":\"devicefleet\", \"BucketName\": \"datapreloadstack-mlopsdatabucket422d8d9c-1veeoqon85us9\"}"
            }
          },
          "com.qualityinspection.model": {
            "ComponentVersion.$": "$.previousOutput.ModelVersion",
            "ConfigurationUpdate": {
              "Merge": "{\"ModelPath\": \"../com.qualityinspection.model\"}},\"Lifecycle\":{\"install\": {\"script\": \"tar xf {artifacts:path}/quality-inspection-model-edgemanager-{ComponentVersion}.tar.gz -C {configuration:/ModelPath}\"}}}"
            }
          },
          "com.qualityinspection": {
            "ComponentVersion.$": "$.infererenceComponent.Payload.LatestVersion",
            "ConfigurationUpdate": {
              "Merge": "{\"com.qualityinspection.model\":{\"VersionRequirement\": \">={com.qualityinspection.model:ComponentVersion}\", \"DependencyType\": \"HARD\"}, \"InferenceInterval\":\"4\"}"
            }
          }
        }
      },
      "Resource": "arn:aws:states:::aws-sdk:greengrassv2:createDeployment",
      "Next": "Wait for deployment state change",
      "ResultPath": "$.createDeploymentOutput"
    },
    "Wait for deployment state change": {
      "Type": "Wait",
      "Seconds": 5,
      "Next": "Get deployment state"
    },
    "Get deployment state": {
      "Type": "Task",
      "Parameters": {
        "DeploymentId.$": "$.createDeploymentOutput.DeploymentId"
      },
      "Resource": "arn:aws:states:::aws-sdk:greengrassv2:getDeployment",
      "Next": "Check deployment state",
      "ResultPath": "$.getDeploymentStatusOutput"
    },
    "Check deployment state": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.getDeploymentStatusOutput.DeploymentStatus",
          "StringMatches": "COMPLETED",
          "Next": "Wait for device state change"
        },
        {
          "Variable": "$.getDeploymentStatusOutput.DeploymentStatus",
          "StringMatches": "ACTIVE",
          "Next": "Wait for deployment state change"
        }
      ],
      "Default": "Fail"
    },
    "Wait for device state change": {
      "Type": "Wait",
      "Seconds": 5,
      "Next": "Get core device state"
    },
    "Get core device state": {
      "Type": "Task",
      "Next": "Check core device state",
      "Parameters": {
        "CoreDeviceThingName.$": "$.describeThingOutput.ThingName"
      },
      "Resource": "arn:aws:states:::aws-sdk:greengrassv2:getCoreDevice",
      "ResultPath": "$.getCoreDeviceOutput"
    },
    "Check core device state": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.getCoreDeviceOutput.Status",
          "StringMatches": "HEALTHY",
          "Next": "Success"
        }
      ],
      "Default": "Fail"
    },
    "Success": {
      "Type": "Succeed"
    },
    "Fail": {
      "Type": "Fail"
    }
  },
  "TimeoutSeconds": 600
}
