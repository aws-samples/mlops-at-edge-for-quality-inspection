import {Aws, aws_ec2 as ec2, aws_iam as iam, aws_s3 as s3, Stack} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AppConfig } from '../../bin/app'
import { GgPrerequisitesConstruct } from "./gg-prerequisites";

export interface GgOnEc2ConstructProps {
    thingIotPolicyName: string
    allowAssumeTokenExchangeRolePolicyName: string
    tokenExchangeRoleAlias: string
    deviceFleetName: string
    iotThingName: string,
    pipelineAssetsPrefix: string
    repoName: string,
    branchName: string
}

export class GgOnEc2Construct extends Construct {

    public readonly deviceRole: iam.Role;
    public readonly iotThingName: string;

    constructor(scope: Construct, id: string, props: AppConfig) {
        super(scope, id);

        const requirementProps = {
            thingName: `EdgeThing-${Stack.of(this).stackName}`,
            thingIotPolicyName: props.ggProps.thingIotPolicyName,
            tokenExchangeRoleAlias: props.ggProps.tokenExchangeRoleAlias,
            allowAssumeTokenExchangeRolePolicyName: props.ggProps.allowAssumeTokenExchangeRolePolicyName
        }

        const ggPrerequisitesConstruct = new GgPrerequisitesConstruct(this, 'greengrass-prerequisites', props);
        this.deviceRole = ggPrerequisitesConstruct.tokenExchangeRole;
        this.iotThingName = ggPrerequisitesConstruct.iotThing.thingName ?? 'no-iot-thing-defined';

        const vpc = new ec2.Vpc(this, 'vpc', {
            cidr: '10.0.0.0/16',
            restrictDefaultSecurityGroup: true,
        });

        const instanceRole = new iam.Role(this, 'gg-instance-role', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
            managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')]
        });

        // based on https://docs.aws.amazon.com/greengrass/v2/developerguide/provision-minimal-iam-policy.html
        instanceRole.addToPolicy(iam.PolicyStatement.fromJson({
            "Effect": "Allow",
            "Action": [
                "iot:AddThingToThingGroup",
                "iot:AttachPolicy",
                "iot:AttachThingPrincipal",
                // TODO should we remove this somehow after the cert was created ?
                "iot:CreateKeysAndCertificate",
                "iot:CreatePolicy",
                "iot:CreateRoleAlias",
                "iot:CreateThing",
                "iot:CreateThingGroup",
                "iot:DescribeEndpoint",
                "iot:DescribeRoleAlias",
                "iot:DescribeThingGroup",
                "sts:GetCallerIdentity",
                "iot:GetPolicy"
            ],
            "Resource": "*"
        }));
        instanceRole.addToPolicy(iam.PolicyStatement.fromJson({
            "Effect": "Allow",
            "Action": [
                "iam:AttachRolePolicy",
                "iam:CreatePolicy",
                "iam:CreateRole",
                "iam:GetPolicy",
                "iam:GetRole",
                "iam:PassRole",
            ],
            "Resource": [
                `arn:aws:iam::${Aws.ACCOUNT_ID}:role/${ggPrerequisitesConstruct.tokenExchangeRole.roleName}`,
                `arn:aws:iam::${Aws.ACCOUNT_ID}:policy/${ggPrerequisitesConstruct.tokenExchangeRole.roleName}Access`,
            ]
        }));



        instanceRole.addToPolicy(iam.PolicyStatement.fromJson({
            "Sid": "DeployDevTools",
            "Effect": "Allow",
            "Action": [
                "greengrass:CreateDeployment",
                "iot:CancelJob",
                "iot:CreateJob",
                "iot:DeleteThingShadow",
                "iot:DescribeJob",
                "iot:DescribeThing",
                "iot:DescribeThingGroup",
                "iot:GetThingShadow",
                "iot:UpdateJob",
                "iot:UpdateThingShadow"
            ],
            "Resource": "*"

        }));
        const mlopsBucket = s3.Bucket.fromBucketName(this, "mlops-bucket", props.assetsBucket)
        this.deviceRole.addToPolicy(iam.PolicyStatement.fromJson({
            "Effect": "Allow",
            "Action": [
                "s3:GetObject*",
                "s3:PutObject*",
                "s3:GetBucket*",
                "s3:List*"
            ],
            "Resource": [
                mlopsBucket.bucketArn,
                `${mlopsBucket.bucketArn}/*`
            ]
        }));

        const userdata = ec2.UserData.forLinux();
        userdata.addCommands(
            'apt -y update',
            'apt -y upgrade',
            'apt -y install unzip python3-pip openjdk-11-jdk-headless build-essential libgl1-mesa-glx',
            'curl -s https://d2s8p88vqu9w66.cloudfront.net/releases/greengrass-nucleus-latest.zip > greengrass-nucleus-latest.zip',
            'unzip greengrass-nucleus-latest.zip -d GreengrassCore && rm greengrass-nucleus-latest.zip',
            'java -Droot="/greengrass/v2" -Dlog.store=FILE ' +
            '  -jar ./GreengrassCore/lib/Greengrass.jar ' +
            `  --aws-region ${Stack.of(this).region} ` +
            `  --thing-name ${ggPrerequisitesConstruct.iotThing.thingName} ` +
            `  --tes-role-name ${ggPrerequisitesConstruct.tokenExchangeRole.roleName}` +
            `  --tes-role-alias-name  ${props.ggProps.tokenExchangeRoleAlias}` +
            `  --thing-policy-name  ${props.ggProps.thingIotPolicyName}` +
            '  --component-default-user ggc_user:ggc_group ' +
            '  --provision true ' +
            '  --setup-system-service true'
        );

        const instance = new ec2.Instance(this, `greengrass-instance`, {
            vpc: vpc,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3_AMD, ec2.InstanceSize.SMALL),


            // Searched in marketplace for Canonical, Ubuntu, 20.04 LTS, amd64 focal image build on 2022-06-10
            machineImage: ec2.MachineImage.genericLinux({
                'us-west-1': 'ami-01154c8b2e9a14885',
                'us-west-2': 'ami-0ddf424f81ddb0720',
                'us-east-1': 'ami-08d4ac5b634553e16',
                'us-east-2': 'ami-0960ab670c8bb45f3',
                'eu-west-1': 'ami-0d2a4a5d69e46ea0b',
                'eu-west-2': 'ami-0bd2099338bc55e6d',
                'eu-central-1': 'ami-0c9354388bb36c088',
                'ap-southeast-1': 'ami-04ff9e9b51c1f62ca',
                'ap-southeast-2': 'ami-0300dc03c13eb7660',
                'ap-south-1': 'ami-006d3995d3a6b963b',
                'ap-northeast-1': 'ami-0f8048fa3e3b9e8ff',
                'ap-northeast-2': 'ami-0ea5eb4b05645aa8a',
                'ca-central-1': 'ami-0665ce57d172e712e',
                }),
            role: instanceRole,
            instanceName: `Greengrass-${Stack.of(this).stackName}`,
            userData: userdata,
            blockDevices: [{
                deviceName: '/dev/sda1',
                volume: ec2.BlockDeviceVolume.ebs(30, {
                    encrypted: true,
                    volumeType: ec2.EbsDeviceVolumeType.GP3,
                    deleteOnTermination: true
                })
            }]
        });

        instance.node.addDependency(ggPrerequisitesConstruct);
    }
}
