import { CfnOutput, Stack, Stage, aws_codecommit as codecommit, aws_codepipeline as codepipeline, aws_iam as iam, pipelines, aws_s3 as s3 } from "aws-cdk-lib";
import { CodePipeline } from 'aws-cdk-lib/aws-events-targets';
import { ShellStep } from "aws-cdk-lib/pipelines";
import { Construct } from "constructs";
import { ExecuteStateMachinePipeline as StateMachinePipeline } from "./statemachine-pipeline";
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { AppConfig } from "../../bin/app";

export class LabelingPipelineStack extends Stack {

    constructor(scope: Construct, id: string, props: AppConfig) {
        super(scope, id, props);

        //pass in our artifacts bucket isntead of creating a new one
        const LabelingPipeline = new codepipeline.Pipeline(this, 'LabelingPipeline', {
            pipelineName: 'MlOpsEdge-Labeling-Infra-Pipeline',
            artifactBucket: s3.Bucket.fromBucketName(this, "mlops-bucket", props.assetsBucket),
            restartExecutionOnUpdate: true
        });


        const pipeline = new pipelines.CodePipeline(this, 'cdk-pipeline', {
            codePipeline: LabelingPipeline,
            codeBuildDefaults: {
                buildEnvironment: { privileged: true },
                rolePolicy: [new iam.PolicyStatement({
                    actions: ['codepipeline:StartPipelineExecution'],
                    resources: ['*'],
                })]
            },

            synth: new pipelines.ShellStep('Synth', {
                input: this.getCodeSource(props),
                commands: [
                    'cd labeling',
                    'npm ci',
                    'npm run build',
                    'npx cdk synth',
                ],
                primaryOutputDirectory: "labeling/cdk.out",
            })
        });

        const stage = new DeployLabelingPipelineStage(this, 'MLOps-Labeling', props);

        const triggerStep = new ShellStep('InvokeLabelingPipeline', {
            envFromCfnOutputs: {
                PIPELINE_NAME: stage.piplineName
            },
            commands: [
                `aws codepipeline start-pipeline-execution --name $PIPELINE_NAME`
            ],
        });

        pipeline.addStage(stage, {
            post: [triggerStep]
        });
        // You need to construct the pipeline before passing it as a target in rule
        pipeline.buildPipeline()
        // create scheduled trigger for labeling pipeline
        const rule = new Rule(this, 'Rule', {
            schedule: Schedule.expression(props.labelingPipelineSchedule),
        });
        rule.addTarget(new CodePipeline(pipeline.pipeline));
    }

    getCodeSource(props: AppConfig) {

        if (props.repoType == "CODECOMMIT" || props.repoType == "CODECOMMIT_PROVIDED") {
            const repo = codecommit.Repository.fromRepositoryName(this, 'ImportedRepo', props.repoName);
            return pipelines.CodePipelineSource.codeCommit(repo, props.branchName, {})
        } else {
            return pipelines.CodePipelineSource.connection(`${props.githubRepoOwner}/${props.repoName}`, props.branchName, { connectionArn: props.githubConnectionArn })
        }
    }
}


export class DeployLabelingPipelineStage extends Stage {

    public readonly piplineName: CfnOutput;

    constructor(scope: Construct, id: string, props: AppConfig) {
        super(scope, id, props);

        const labelingPipelineStack = new StateMachinePipeline(this, 'Statemachine-Pipeline-Stack', {
            ...props,
            stackName: "LabelingPipelineStack"
        });
        this.piplineName = labelingPipelineStack.labelingPipelineName;

    }
}
