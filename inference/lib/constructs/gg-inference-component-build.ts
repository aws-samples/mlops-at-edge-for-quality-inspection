import { 
    aws_codebuild as codebuild,
    aws_iam as iam, 
    Duration, 
    StackProps,
    Stage} from 'aws-cdk-lib';
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
                }
            } )
        });
      
        ggInferenceComponentBuild.role?.addToPrincipalPolicy(new iam.PolicyStatement({
            actions: ['iam:PassRole', 's3:*', 'greengrass:*', 'iot:DescribeThing', 'cloudformation:DescribeStacks'],
            resources: ['*'],
        }));
        
        this.ggInferenceComponentBuild = ggInferenceComponentBuild
}
}

