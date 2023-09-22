import {
    Duration,
    StackProps,
    aws_codebuild as codebuild,
    aws_iam as iam
} from 'aws-cdk-lib';
import { LinuxBuildImage, LocalCacheMode } from 'aws-cdk-lib/aws-codebuild';
import { Construct } from 'constructs';

export class GgInferenceComponentBuildConstruct extends Construct {
    readonly ggInferenceComponentBuild: codebuild.PipelineProject;

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id);

        const ggInferenceComponentBuild = new codebuild.PipelineProject(this, 'GgInferenceComponentBuild', {
            timeout: Duration.minutes(30),
            buildSpec: codebuild.BuildSpec.fromObject({
                version: "0.2",
                phases: {
                    pre_build: {
                        commands: [
                            'pip3 install --upgrade awscli'
                        ]
                    },
                    build: {
                        commands: [
                            'cd inference/lib/assets/gg_components/;chmod +x buildNewInferenceComponentVersion.sh;./buildNewInferenceComponentVersion.sh',
                        ]
                    }
                },
                environment: {
                    buildImage: LinuxBuildImage.AMAZON_LINUX_2_3,
                    localCache: LocalCacheMode.DOCKER_LAYER
                }
            })
        });



        ggInferenceComponentBuild.role?.addToPrincipalPolicy(new iam.PolicyStatement({
            actions: ['s3:GetObject', 's3:PutObject', 'greengrass:ListComponents', 'greengrass:CreateComponentVersion', 'iot:DescribeThing', 'cloudformation:DescribeStacks'],
            resources: ['*'],
        }));

        this.ggInferenceComponentBuild = ggInferenceComponentBuild
    }
}

