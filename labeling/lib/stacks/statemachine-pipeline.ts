import {
    aws_codecommit as codecommit,
    aws_codepipeline as codepipeline,
    aws_codepipeline_actions as codepipeline_actions, CfnOutput, Duration, Fn, Stack
} from "aws-cdk-lib";
import { CodeCommitTrigger } from "aws-cdk-lib/aws-codepipeline-actions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from "constructs";

import { PipelineAssets } from "../constructs/labeling-pipeline-assets";
import { AppConfig } from "../../bin/app";

/**
 * Stack to create Pipeline in Codepipeline which is responsible to execute Stepfunctions Statemachine
 */

export interface StateMachinePipelineProps extends AppConfig {
    readonly assetsBucket: string;
}
export class ExecuteStateMachinePipeline extends Stack {
    public readonly labelingPipelineName: CfnOutput;

    constructor(scope: Construct, id: string, props: StateMachinePipelineProps) {
        super(scope, id);

        //deploy all assets required by the labeling pipeline
        const pipelineAssets = new PipelineAssets(this, 'LabelingPipelineAssets', props);

        const stateMachine = new sfn.StateMachine(this, 'Labeling', {
            definition: this.getStateMachineDefinition(pipelineAssets),
            stateMachineName: 'Quality-Inspection-Labeling'
        });

        const stepFunctionAction = new codepipeline_actions.StepFunctionInvokeAction({
            actionName: 'Invoke',
            stateMachine: stateMachine,
            stateMachineInput: codepipeline_actions.StateMachineInput.literal({}),
        });

        const labelingExecutionPipeline = new codepipeline.Pipeline(this, 'LabelingExecutionPipeline', {
            artifactBucket: Bucket.fromBucketName(this, "artifactsbucket", props.assetsBucket),
            pipelineName: 'MlOpsEdge-Labeling-Pipeline',
            crossAccountKeys: false,
            stages: [
                {
                    stageName: 'Source',
                    actions: [this.getCodeSource(props)],
                },
                {
                    stageName: 'RunLabelingPipeline',
                    actions: [stepFunctionAction],
                },
            ],
        });

        this.labelingPipelineName = new CfnOutput(this, 'LabelingPipelineNameExport', {
            value: labelingExecutionPipeline.pipelineName
        });
    }

    getCodeSource(props: AppConfig) {
        const sourceOutput = new codepipeline.Artifact();
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
                connectionArn: props.githubConnectionArn,
                // not triggering ad the pipeline will be triggered by infrastructure pipeline anyways
                triggerOnPush: false,
            });
        }
    }
    /**
     * Defines the statemachine which executes the labeling workflow
     * @param pipelineAssets 
     * @returns StateMachineDefintion
     */
    getStateMachineDefinition(pipelineAssets: PipelineAssets) {

        const success = new sfn.Succeed(this, "Labeling Pipeline execution succeeded")
        const fail = new sfn.Fail(this, "Labeling Pipeline execution failed")


        const checkMissingLabels = new tasks.LambdaInvoke(this, "CheckMissingLabels", {
            lambdaFunction: pipelineAssets.check_missing_labels_lambda
        })

        const updateFeatureStore = new tasks.LambdaInvoke(this, "UpdateLabelsInFeatureStore", {
            lambdaFunction: pipelineAssets.update_feature_store_lambda,
            payload: sfn.TaskInput.fromObject({
                executionId: sfn.JsonPath.stringAt('$$.Execution.Id'),
                verification_job_output: sfn.JsonPath.stringAt('$.LabelingJobOutput.OutputDatasetS3Uri'),
            }),
        })
        const runLabelingJob = new tasks.LambdaInvoke(this, "StartLabelingJob", {
            lambdaFunction: pipelineAssets.labeling_job_lambda,
            payload: sfn.TaskInput.fromObject({
                executionId: sfn.JsonPath.stringAt('$$.Execution.Id'),
                request: sfn.JsonPath.entirePayload,
            }),
            outputPath: '$.Payload',
        })
        const runVerificationJob = new tasks.LambdaInvoke(this, "StartVerificationJob", {
            lambdaFunction: pipelineAssets.verification_job_lambda,
            payload: sfn.TaskInput.fromObject({
                executionId: sfn.JsonPath.stringAt('$$.Execution.Id'),
                input_manifest: sfn.JsonPath.stringAt('$.LabelingJobOutput.OutputDatasetS3Uri'),
            }),
            outputPath: '$.Payload',
        })

        // first run check missing labels lambda
        const definition = checkMissingLabels

            .next(new sfn.Choice(this, 'Missing Labels?')
                // if all images are labeled, end pipeline
                .when(sfn.Condition.numberEquals('$.Payload.missing_labels_count', 0), success).
                otherwise(runLabelingJob
                    // otherwise run labeling job
                    .next(this.createLabelingJobWaiter('LabelingJob', fail, runVerificationJob
                        //then run verification job and update labels in feature store
                        .next(this.createLabelingJobWaiter('VerificationJob', fail, updateFeatureStore
                            .next(success)))))))

        return definition
    }

    createLabelingJobWaiter(labelingJobName: string, fail: sfn.Fail, next: sfn.IChainable) {

        const getLabelingJobStatus = new tasks.CallAwsService(this, `Get ${labelingJobName} status`, {
            service: 'sagemaker',
            action: 'describeLabelingJob',
            parameters: {
                LabelingJobName: sfn.JsonPath.stringAt('$.LabelingJobName')
            },
            iamResources: ['*'],
        });

        const waitX = new sfn.Wait(this, `Waiting for - ${labelingJobName} - completion`, {

            time: sfn.WaitTime.duration(Duration.seconds(30)),
        });

        return waitX.next(getLabelingJobStatus).next(new sfn.Choice(this, `${labelingJobName} Complete?`)
            // Look at the "status" field
            .when(sfn.Condition.stringEquals('$.LabelingJobStatus', 'Failed'), fail)
            .when(sfn.Condition.stringEquals('$.LabelingJobStatus', 'Stopped'), fail)
            .when(sfn.Condition.stringEquals('$.LabelingJobStatus', 'Completed'), next)
            .otherwise(waitX))


    }
}


