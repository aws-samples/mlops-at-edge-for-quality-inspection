#!/usr/bin/env node
import { App, Aspects, Stack, StackProps } from 'aws-cdk-lib';
import * as fs from 'fs';
import { load } from "js-yaml";
import * as path from "path";
import 'source-map-support/register';
import { LabelingInitStack as InitStack } from '../lib/stacks/init';
import { AwsSolutionsChecks , NagSuppressions} from 'cdk-nag';

const app = new App();

export interface AppConfig extends StackProps{
  readonly repoType: string;
  readonly repoName: string;
  readonly branchName: string;
  readonly featureGroupName: string;
  readonly modelPackageGroupName: string;
  readonly modelPackageGroupDescription: string;

}
function getConfig() {
  let configYaml: any = load(fs.readFileSync(path.resolve("./config.yaml"), "utf8"));
  let repoConfigYaml: any = load(fs.readFileSync(path.resolve("../repo_config.yaml"), "utf8"));
  let appConfig: AppConfig = {
      repoType: repoConfigYaml['repoType'],
      repoName: repoConfigYaml['repoName'],
      branchName: repoConfigYaml['branchName'],
      featureGroupName: configYaml['featureGroupName'],
      modelPackageGroupName: configYaml['modelPackageGroupName'],
      modelPackageGroupDescription: configYaml['modelPackageGroupDescription'],
  };
  return appConfig;
}

async function Main() {

  let appConfig: AppConfig = getConfig();
  let initStack = new InitStack(app, 'MLOps-Init-Stack', appConfig);
  addSecurityChecks(app,[initStack])
  app.synth();
}


function addSecurityChecks(app:App, stacks: Stack[]){
    for (let stack in stacks) {
        NagSuppressions.addStackSuppressions(stacks[stack],[{id: "AwsSolutions-IAM4", reason: "Suppress disallowed use of managed policies for increased simplicity as this is a sample. Scope down in production!" }])
        NagSuppressions.addStackSuppressions(stacks[stack],[{id: "AwsSolutions-IAM5", reason: "Suppress disallowed use of wildcards in IAM policies for increased simplicity as this is a sample. Scope down in production!" }])
        NagSuppressions.addStackSuppressions(stacks[stack],[{id: "AwsSolutions-L1", reason: "Using fixed python version for lambda functions as sample needs to be stable" }])
        NagSuppressions.addStackSuppressions(stacks[stack],[{id: "AwsSolutions-CB3", reason: "Suppress warning for use of privileged mode for codebuild, as this is required for docker image build" }])
        NagSuppressions.addStackSuppressions(stacks[stack],[{id: "AwsSolutions-CB4", reason: "Suppress required use of KMS for CodeBuild as it incurs additional cost. Consider using KMS for Codebuild in production" }])
    }
    Aspects.of(app).add(new AwsSolutionsChecks({verbose:true}));
}
Main();

