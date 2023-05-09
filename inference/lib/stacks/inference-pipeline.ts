import * as cdk from 'aws-cdk-lib';
import { aws_codecommit as codecommit, aws_codepipeline as codepipeline, aws_iam as iam, aws_s3 as s3, pipelines,CfnOutput, Stage } from 'aws-cdk-lib';
import { CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { AppConfig } from '../../bin/app';
import { Inference } from './inference';

class InferenceCdkPipelineStage extends Stage {
    readonly pipelineName : CfnOutput;
    constructor(scope: Construct, id: string, props: AppConfig) {
        super(scope, id, props);
        const inferenceStack = new Inference(this, 'Statemachine-Pipeline-Stack', props)
        this.pipelineName = inferenceStack.pipelineName
    }
}

export class InferenceCdkPipeline extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AppConfig) {
    super(scope, id, props);

    //pass in our artifacts bucket instead of creating a new one
    const infra_pipeline = new codepipeline.Pipeline(this, 'LabelingPipeline', {
                pipelineName: 'MlOpsEdge-Inference-Infra-Pipeline',
                artifactBucket: s3.Bucket.fromBucketName(this, "mlops-bucket", props.assetsBucket),
                restartExecutionOnUpdate: true
              });

    const pipeline = new CodePipeline(this, 'MlOpsEdge-Inference-Pipeline', {
        codePipeline: infra_pipeline,

        codeBuildDefaults: {
            buildEnvironment: {privileged: true},
            rolePolicy: [new iam.PolicyStatement({
                actions: ['codepipeline:StartPipelineExecution'],
                // TODO least priviledge. Use arn of above mlOpsPipelineStage->Stack->Pipeline
                resources: ['*'],
            })]
        },
        synth: new ShellStep('Synth', {
            input: this.getCodeSource(props),
            commands: [
                'cd inference',
                'npm ci',
                'npm run build',
                'npx cdk synth',
            ],
            primaryOutputDirectory: "inference/cdk.out",
        })
    });

    const inferenceStage = new InferenceCdkPipelineStage(this, "MLOps-Inference", props)
    
    const triggerStep = new ShellStep('InvokeInferencePipeline', {
        envFromCfnOutputs: {
            PIPELINE_NAME: inferenceStage.pipelineName
        },
        commands: [
            `aws codepipeline start-pipeline-execution --name $PIPELINE_NAME`
        ],
    });


    pipeline.addStage(inferenceStage, {
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
