import {
  aws_codebuild as codebuild,
  aws_codecommit as codecommit,
  aws_codepipeline as codepipeline,
  aws_codepipeline_actions as codepipeline_actions,
  aws_iam as iam, CfnOutput,
  aws_s3 as s3,
  Duration, Stack
} from 'aws-cdk-lib';
import { LinuxBuildImage, LocalCacheMode } from "aws-cdk-lib/aws-codebuild";
import { CodeCommitTrigger } from "aws-cdk-lib/aws-codepipeline-actions";
import { Construct } from 'constructs';
import { TrainingPipelineAssets } from "../constructs/training-pipeline-assets";
import { AppConfig } from "../../bin/app";

export class TrainingSageMakerPipeline extends Stack {

  public readonly trainingPipelineName: CfnOutput;

  constructor(scope: Construct, id: string, props: AppConfig) {
    super(scope, id);

    const sagemakerPipeline = new TrainingPipelineAssets(this, 'TrainingPipelineAssets', props);

    const runSageMakerPipelineCodeBuildProject = new codebuild.PipelineProject(this, 'TrainingProject', {
      environmentVariables: {
        PIPELINE_ASSETS_PREFIX: { value: `s3://${props.assetsBucket}/${props.pipelineAssetsPrefix}` },
        PIPELINE_ROLE: { value: sagemakerPipeline.pipelineRole.value },
        PREPROCESS_IMAGE: { value: sagemakerPipeline.preprocessImageURI.value },
        FEATURE_GROUP_NAME: { value: props.featureGroupName },
        MODEL_PACKAGE_GROUP_NAME: { value: props.modelPackageGroupName },
        TRAINING_INSTANCE_TYPE: {value: props.trainingInstanceType}
      },
      timeout: Duration.hours(8),
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
              'echo ${PIPELINE_ROLE}',
              'cd training/lib/assets/sagemaker_pipeline/; pip install -r requirements.txt;python3 construct_and_run_pipeline.py'
            ]
          }
        },
        environment: {
          buildImage: LinuxBuildImage.AMAZON_LINUX_2_3,
          localCache: LocalCacheMode.DOCKER_LAYER,
          priviledged: true
        }
      })
    });

    runSageMakerPipelineCodeBuildProject.role?.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['sagemaker:*', 'codepipeline:StartPipelineExecution'],
      resources: ['*'],
    }));

      runSageMakerPipelineCodeBuildProject.role?.addToPrincipalPolicy(new iam.PolicyStatement({
          actions: ['s3:*', ],
          resources: [`arn:aws:s3:::${props.assetsBucket}`, `arn:aws:s3:::${props.assetsBucket}/*`,
                        // the default bucket created by sagemaker
                      `arn:aws:s3:::sagemaker-${this.region}-${this.account}`, `arn:aws:s3:::sagemaker-${this.region}-${this.account}/*`,
          ]
      }));

      runSageMakerPipelineCodeBuildProject.role?.addToPrincipalPolicy(new iam.PolicyStatement({
          actions: ['iam:PassRole'],
          resources: [sagemakerPipeline.pipelineRole.value],
      }));

    const sourceOutput = new codepipeline.Artifact();

    const trainingSageMakerPipelineTrigger = new codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuild',
      project: runSageMakerPipelineCodeBuildProject,
      input: sourceOutput
    });

    const trainingExecutionPipeline = new codepipeline.Pipeline(this, 'TrainingExecutionPipeline', {
      artifactBucket: s3.Bucket.fromBucketName(this, "artifactsbucket", props.assetsBucket),
      pipelineName: 'MlOpsEdge-Training-Pipeline',
      stages: [
        {
          stageName: 'Source',
          actions: [this.getCodeSource(props,sourceOutput)],
        },
        {
          stageName: 'RunSageMakerPipeline',
          actions: [trainingSageMakerPipelineTrigger],
        },
      ],
    });

    this.trainingPipelineName = new CfnOutput(this, 'PipelineNameExport', {
      value: trainingExecutionPipeline.pipelineName
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
            connectionArn: props.githubConnectionArn,
            // not triggering ad the pipeline will be triggered by infrastructure pipeline anyways
            triggerOnPush: false,
        });
    }
}
}




