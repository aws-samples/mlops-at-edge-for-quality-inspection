import {
    aws_codebuild as codebuild, aws_s3 as s3,aws_codecommit as codecommit, aws_codepipeline as codepipeline, aws_codepipeline_actions as codepipeline_actions, CfnOutput
} from 'aws-cdk-lib';
import { StepFunctionInvokeAction } from "aws-cdk-lib/aws-codepipeline-actions";
import {CodeCommitTrigger} from "aws-cdk-lib/aws-codepipeline-actions";
import { Construct } from 'constructs';
import { AppConfig } from '../../bin/app'

export interface EdgeCiCdPipelineConstructProps extends AppConfig{
    iotThingName: string,
    ggInferenceComponentBuild: codebuild.PipelineProject
    edgeDeploymentStepFunction: StepFunctionInvokeAction
}

export class EdgeCiCdPipelineConstruct extends Construct {
    public readonly pipelineName: CfnOutput;

    constructor(scope: Construct, id: string, props: EdgeCiCdPipelineConstructProps) {
        super(scope, id);

      
        const sourceOutput = new codepipeline.Artifact();


        const deployGreengrassComponentPipelineTrigger = new codepipeline_actions.CodeBuildAction({
            actionName: 'CodeBuild',
            project: props.ggInferenceComponentBuild,
            input: sourceOutput,
            environmentVariables: {
                IOT_THING_NAME: { value: props.iotThingName },
                ARTIFACT_BUCKET: { value: props.assetsBucket }
            }
        });

        const pipeline =  new codepipeline.Pipeline(this, 'InferenceCiCdPipeline', {
            pipelineName: 'MlOpsEdge-Inference-Pipeline',
            artifactBucket: s3.Bucket.fromBucketName(this, "artifactsbucket", props.assetsBucket),
            stages: [
                {
                    stageName: 'Source',
                    actions: [this.getCodeSource(props,sourceOutput)],
                },
                {
                    stageName: 'CreateNewInferenceComponentVersion',
                    actions: [deployGreengrassComponentPipelineTrigger],
                },
                {
                    stageName: 'PackageAndDeployComponentsToEdgeDevice',
                    actions: [props.edgeDeploymentStepFunction],
                },
            ],
        });
    
        this.pipelineName = new CfnOutput(this, 'LabelingPipelineNameExport', {
            value: pipeline.pipelineName
        });

    }

    getCodeSource(props: AppConfig, sourceOutput: codepipeline.Artifact) {
        if (props.repoType == "CODECOMMIT" || props.repoType == "CODECOMMIT_PROVIDED") {
             const repository = codecommit.Repository.fromRepositoryName(this, 'repository', props.repoName)
             return new codepipeline_actions.CodeCommitSourceAction({
                 actionName: 'CodeCommit',
                 repository,
                 branch: props.branchName,
                 output: sourceOutput,
                 trigger: CodeCommitTrigger.NONE,
             });
         } else {
             return new codepipeline_actions.CodeStarConnectionsSourceAction({
                 actionName: `${props.githubRepoOwner}_${props.repoName}`,
                 branch: props.branchName,
                 output: sourceOutput,
                 owner: props.githubRepoOwner,
                 repo: props.repoName,
                 // not triggering ad the pipeline will be triggered by infrastructure pipeline anyways
                 triggerOnPush: false,
                 connectionArn: props.githubConnectionArn

             });
         }
     }
}
