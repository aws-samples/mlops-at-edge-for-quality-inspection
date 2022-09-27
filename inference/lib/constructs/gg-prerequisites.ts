import {Aws, aws_iam as iam, aws_iot as iot, Stack} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import { AppConfig } from '../../bin/app'

export interface GgRequirementConstructProps {
    thingIotPolicyName: string,
    tokenExchangeRoleAlias: string,
    allowAssumeTokenExchangeRolePolicyName: string,
    thingName: string
}

export class GgPrerequisitesConstruct extends Construct {

    readonly iotThing: iot.CfnThing;
    readonly tokenExchangeRole: iam.Role;

    constructor(scope: Construct, id: string, props: AppConfig) {
        super(scope, id);

        this.iotThing = new iot.CfnThing(this, 'thing-edge-inference', {
            thingName: `EdgeThing-${Stack.of(this).stackName}`
        });

        this.tokenExchangeRole = new iam.Role(this, 'token-exchange-iam-role', {
            assumedBy: new iam.CompositePrincipal(
                new iam.ServicePrincipal('iot.amazonaws.com'),
                new iam.ServicePrincipal('credentials.iot.amazonaws.com'),
                new iam.ServicePrincipal('sagemaker.amazonaws.com')
            ),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonSageMakerEdgeDeviceFleetPolicy'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess') 
            ]
        });

        const tokenExchangePolicyDoc = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Action": [
                        "iot:DescribeCertificate",
                        "logs:CreateLogGroup",
                        "logs:CreateLogStream",
                        "logs:PutLogEvents",
                        "logs:DescribeLogStreams",
                        "iot:Connect",
                        "iot:Publish",
                        "iot:Subscribe",
                        "iot:Receive",
                        "s3:GetBucketLocation"
                    ],
                    "Resource": "*"
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "s3:GetObject"
                    ],
                    "Resource": [
                        // TODO remove this hard coded value
                        "arn:aws:s3:::greengrassstack-dev-modelartifactbuckettempb4b728-1a7jzrtqoktbd/*"
                    ]
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "iam:GetRole",
                        "iam:PassRole",
                    ],
                    "Resource": [
                        `arn:aws:iam::${Aws.ACCOUNT_ID}:role/${this.tokenExchangeRole.roleName}`
                    ]
                }
            ]
        }

        new iam.ManagedPolicy(this, 'token-exchange-iam-policy', {
            document: iam.PolicyDocument.fromJson(tokenExchangePolicyDoc),
            roles: [this.tokenExchangeRole],
            managedPolicyName: `${this.tokenExchangeRole.roleName}Access`
        });


        const roleAlias = new iot.CfnRoleAlias(this, 'GGIoTRoleAlias', {
            roleArn: this.tokenExchangeRole.roleArn,
            roleAlias: props.ggProps.tokenExchangeRoleAlias,
        });

        new iot.CfnPolicy(this, 'IoTPolicy', {
            policyDocument: {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Action": [
                            "iot:Publish",
                            "iot:Subscribe",
                            "iot:Receive",
                            "iot:Connect",
                            "greengrass:*"
                        ],
                        "Resource": [
                            "*"
                        ]
                    }
                ]
            },
            policyName: props.ggProps.thingIotPolicyName
        });

        const allowAssumeTokenExchangeRole = new iot.CfnPolicy(this, 'allowAssumeTokenExchangeRole', {
            policyName: props.ggProps.allowAssumeTokenExchangeRolePolicyName,
            policyDocument: {
                "Version":"2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Action": "iot:AssumeRoleWithCertificate",
                        "Resource": roleAlias.attrRoleAliasArn
                    }
                ]
            }
        });
        allowAssumeTokenExchangeRole.node.addDependency( roleAlias );
    }
}

