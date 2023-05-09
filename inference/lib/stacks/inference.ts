
import {
  aws_codepipeline as codepipeline, CfnOutput, Stack
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AppConfig } from '../../bin/app';
import { EdgeCiCdPipelineConstruct } from '../constructs/edge-cicd-pipeline';
import { EdgeDeploymentOrchestrationConstruct } from "../constructs/edge-deployment-orchestration";
import { GgInferenceComponentBuildConstruct } from '../constructs/gg-inference-component-build';
import { GgOnEc2Construct } from "../constructs/gg-on-ec2";

export class Inference extends Stack {

  readonly edgeDeploymentPipeline: codepipeline.Pipeline;
  readonly pipelineName :CfnOutput;
  constructor(scope: Construct, id: string, props: AppConfig) {
    super(scope, id, props);
    
    // BASE INFRASTRUCTURE
    const ggConstruct = new GgOnEc2Construct(this, 'GreengrassOnEc2Construct', props);

    // INFERENCE COMPONENT BUILD
    const ggInferenceComponentBuildConstruct = new GgInferenceComponentBuildConstruct(this, 'InferenceComponentBuildConstruct')
    
    // EDGE DEPLOYMENT ORCHESTRATION
    const edgeDeploymentOrchestrationConstruct = new EdgeDeploymentOrchestrationConstruct(this, 'EdgeDeploymentOrchestrationConstruct', {...props,
      iotThingName: ggConstruct.iotThingName});

    // EDGE CI/CD PIPELINE
    const cicdPipeline = new EdgeCiCdPipelineConstruct(this, 'EdgeCiCdPipelineConstruct',  {...props,
      iotThingName: ggConstruct.iotThingName,
      ggInferenceComponentBuild: ggInferenceComponentBuildConstruct.ggInferenceComponentBuild,
      edgeDeploymentStepFunction: edgeDeploymentOrchestrationConstruct.stepFunctionAction
    });

    this.pipelineName = cicdPipeline.pipelineName
  }
}

