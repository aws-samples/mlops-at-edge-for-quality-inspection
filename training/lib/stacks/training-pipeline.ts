import { aws_codecommit as codecommit, aws_s3 as s3, aws_codepipeline as codepipeline, aws_iam as iam, Fn, pipelines, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { ShellStep } from "aws-cdk-lib/pipelines";
import { CfnOutput, Stage } from "aws-cdk-lib";
import { TrainingSageMakerPipeline} from "./training-sagemaker-pipeline";
import { AppConfig } from "../../bin/app";

export class TrainingPipeline extends Stack {

    constructor(scope: Construct, id: string, props: AppConfig) {
        super(scope, id, props);

        
        //pass in our artifacts bucket instead of creating a new one
        const trainingPipeline = new codepipeline.Pipeline(this, 'trainingPipeline', {
            pipelineName: 'MlOpsEdge-Training-Infra-Pipeline',
            artifactBucket: s3.Bucket.fromBucketName(this, "mlops-bucket", props.assetsBucket),
            restartExecutionOnUpdate: true
            });

        const pipeline = new pipelines.CodePipeline(this, 'TrainingCdkPipeline', {
            codePipeline: trainingPipeline,
            codeBuildDefaults: {
                buildEnvironment: { privileged: true },
                rolePolicy: [new iam.PolicyStatement({
                    actions: ['codepipeline:StartPipelineExecution'],
                    // TODO least priviledge. Use arn of above mlOpsPipelineStage->Stack->Pipeline
                    resources: ['*'],
                })]
            },
  
            synth: new pipelines.ShellStep('Synth', {
                input: this.getCodeSource(props),
                commands: [
                    'cd training',
                    'npm ci',
                    'npm run build',
                    'npx cdk synth',
                ],
                primaryOutputDirectory: "training/cdk.out",
            })
        });

        const stage = new TrainingCdkPipelineStage(this, 'MLOps-Training', props);

        const triggerStep = new ShellStep('InvokeTrainingPipeline', {
            envFromCfnOutputs: {
                PIPELINE_NAME: stage.pipelineName
            },
            commands: [
                `aws codepipeline start-pipeline-execution --name $PIPELINE_NAME`
            ],
        });

        pipeline.addStage(stage, {
            post: [triggerStep]
        });
    }
    getCodeSource(props: AppConfig) {

        if (props.repoType == "CODECOMMIT" || props.repoType == "CODECOMMIT_PROVIDED") {
            const repo = codecommit.Repository.fromRepositoryName(this, 'ImportedRepo', props.repoName);
            return pipelines.CodePipelineSource.codeCommit(repo, props.branchName, {})
        }else{
            return pipelines.CodePipelineSource.connection(`${props.githubRepoOwner}/${props.repoName}`,props.branchName,{connectionArn: props.githubConnectionArn})
        }
    }
}

class TrainingCdkPipelineStage extends Stage {
    public readonly pipelineName: CfnOutput;

    constructor(scope: Construct, id: string, props: AppConfig) {
        super(scope, id, props);
        const trainingStack = new TrainingSageMakerPipeline(this, 'SageMaker-Pipeline-Stack', {
            ...props,
            stackName: "TrainingPipelineStack"
        });
        this.pipelineName = trainingStack.trainingPipelineName;
    }
}

