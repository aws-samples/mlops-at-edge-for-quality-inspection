import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import {
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs, aws_stepfunctions as stepfunctions,
  Duration,
  Stack
} from 'aws-cdk-lib';
import { StateMachineInput, StepFunctionInvokeAction } from "aws-cdk-lib/aws-codepipeline-actions";
import { StateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from 'constructs';
import * as path from 'path';
import { AppConfig } from '../../bin/app'

export interface EdgeDeploymentOrchestrationConstructProps extends AppConfig {
  iotThingName: string;
}
export class EdgeDeploymentOrchestrationConstruct extends Construct {

  static readonly MODEL_PACKAGE_GROUP_NAME = 'TagQualityInspectionPackageGroup';

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
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSIoTFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess')
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
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess')
      ]
    });

    const findLatestComponentVersionFunction = new lambda_python.PythonFunction(this, 'LatestComponentVersion', {
      entry: path.join('lib', 'assets', 'gg_component_version_helper'),
      index: 'setup.py',
      runtime: lambda.Runtime.PYTHON_3_11,
      logRetention: logs.RetentionDays.ONE_DAY,
      role: lambdaRole,
      timeout: Duration.seconds(15),
      environment: {
        'SAGEMAKER_ROLE_ARN': stepFunctionRole.roleArn
      }
    });
    const findModelBlobURL = new lambda_python.PythonFunction(this, 'ModelBlobURL', {
      entry: path.join('lib', 'assets', 'model_version_helper'),
      index: 'setup.py',
      runtime: lambda.Runtime.PYTHON_3_11,
      logRetention: logs.RetentionDays.ONE_DAY,
      role: lambdaRole,
      timeout: Duration.seconds(15),
    });

    asl.States['Get model blob url'].Parameters.FunctionName = findModelBlobURL.functionArn;
    asl.States['Get next Greengrass model component version'].Parameters.FunctionName = findLatestComponentVersionFunction.functionArn;
    asl.States['Get next Greengrass model component version'].Parameters.Payload.ComponentName = props.deploymentProps.ggModelComponentName;
    asl.States['Get inference component version'].Parameters.FunctionName = findLatestComponentVersionFunction.functionArn;
    asl.States['Get inference component version'].Parameters.Payload.ComponentName = props.deploymentProps.ggInferenceComponentName;
    asl.States['Get IoT Thing ARN'].Parameters.ThingName = props.iotThingName;

    const packageModelWorkflow = new stepfunctions.CfnStateMachine(this, 'EdgeDeploymentOrchestrationStepFunction', {
      roleArn: stepFunctionRole.roleArn,
      definitionString: JSON.stringify(asl),
      stateMachineName: this.stepFunctionName
    });

    const stepFunctionInput = {
      "ModelPackageGroupName": props.deploymentProps.smModelPackageGroupName,
      "invokationSource": "CodeBuild",
      "modelArn": ""
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
  "StartAt": "Get model blob url",
  "States": {
    "Get model blob url": {
      "Type": "Task",
      "Next": "Get next Greengrass model component version",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "",
        "Payload.$": "$"
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException"
          ],
          "IntervalSeconds": 1,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "ResultSelector": {
        "value.$": "$.Payload.ModelUrl"
      },
      "ResultPath": "$.ModelUrl",
    },
    "Get next Greengrass model component version": {
      "Type": "Task",
      "Next": "Create new Greengrass model component",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "",
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
      "ResultSelector": {
        "value.$": "$.Payload.NextVersion"
      },
      "ResultPath": "$.ModelNextVersion"
    },
    "Create new Greengrass model component": {
      "Type": "Task",
      "Next": "Get IoT Thing ARN",
      "Parameters": {
        "InlineRecipe": {
          "RecipeFormatVersion": "2020-01-25",
          "ComponentName": "com.qualityinspection.model",
          "ComponentVersion.$": "$.ModelNextVersion.value",
          "ComponentPublisher": "AWS",
          "Manifests": [
            {
              "Platform": {
                "os": "*",
                "architecture": "*"
              },
              "Lifecycle": {
                "Install": {
                  "Script": "tar xzf {artifacts:path}/model.tar.gz -C {artifacts:decompressedPath}",
                  "RequiresPrivilege": true
                },
                "Upgrade": {
                  "Script": "tar xzf {artifacts:path}/model.tar.gz -C {artifacts:decompressedPath}",
                  "RequiresPrivilege": true
                },
                "Uninstall": {
                  "Script": "rm -rf {artifacts:decompressedPath} {artifacts:path}",
                  "RequiresPrivilege": true
                }
              },
              "Artifacts": [
                {
                  "Uri.$": "$.ModelUrl.value",
                  "Permission": {
                    "Read": "OWNER",
                    "Execute": "NONE"
                  }
                }
              ]
            }
          ]
        }
      },
      "Resource": "arn:aws:states:::aws-sdk:greengrassv2:createComponentVersion",
      "ResultPath": null
    },
    "Get IoT Thing ARN": {
      "Type": "Task",
      "Next": "Get inference component version",
      "Parameters": {
        "ThingName": "EdgeThing-MLOps-Inference-Statemachine-Pipeline-Stack"
      },
      "Resource": "arn:aws:states:::aws-sdk:iot:describeThing",
      "ResultSelector": {
        "Arn.$": "$.ThingArn",
        "Name.$": "$.ThingName"
      },
      "ResultPath": "$.IotThing"
    },
    "Get inference component version": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "",
        "Payload": {
          "ComponentName": "com.qualityinspection"
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
      "ResultSelector": {
        "value.$": "$.Payload.LatestVersion"
      },
      "ResultPath": "$.InfererenceComponentVersion"
    },
    "Create new deployment": {
      "Type": "Task",
      "Parameters": {
        "TargetArn.$": "$.IotThing.Arn",
        "Components": {
          "aws.greengrass.Nucleus": {
            "ComponentVersion": "2.9.6",
            "ConfigurationUpdate": {
              "Merge": {
                "DefaultConfiguration": {
                  "interpolateComponentConfiguration": true
                }
              }
            }
          },
          "aws.greengrass.Cli": {
            "ComponentVersion": "2.9.6"
          },
          "com.qualityinspection.model": {
            "ComponentVersion.$": "$.ModelNextVersion.value"
          },
          "com.qualityinspection": {
            "ComponentVersion.$": "$.InfererenceComponentVersion.value",
            "ConfigurationUpdate": {
              "Merge": "{\"com.qualityinspection.model\":{\"VersionRequirement\": \">={com.qualityinspection.model:ComponentVersion}\", \"DependencyType\": \"HARD\"}}"
            }
          }
        }
      },
      "Resource": "arn:aws:states:::aws-sdk:greengrassv2:createDeployment",
      "Next": "Wait for deployment state change",
      "ResultSelector": {
        "value.$": "$.DeploymentId"
      },
      "ResultPath": "$.DeploymentId"
    },
    "Wait for deployment state change": {
      "Type": "Wait",
      "Seconds": 5,
      "Next": "Get deployment state"
    },
    "Get deployment state": {
      "Type": "Task",
      "Parameters": {
        "DeploymentId.$": "$.DeploymentId.value"
      },
      "Resource": "arn:aws:states:::aws-sdk:greengrassv2:getDeployment",
      "Next": "Check deployment state",
      "ResultSelector": {
        "value.$": "$.DeploymentStatus"
      },
      "ResultPath": "$.DeploymentStatus"
    },
    "Check deployment state": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.DeploymentStatus.value",
          "StringMatches": "COMPLETED",
          "Next": "Wait for device state change"
        },
        {
          "Variable": "$.DeploymentStatus.value",
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
        "CoreDeviceThingName.$": "$.IotThing.Name"
      },
      "Resource": "arn:aws:states:::aws-sdk:greengrassv2:getCoreDevice",
      "ResultSelector": {
        "value.$": "$.Status"
      },
      "ResultPath": "$.CoreDeviceStatus"
    },
    "Check core device state": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.CoreDeviceStatus.value",
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
