#!/usr/bin/env node
import { App, StackProps ,Fn} from 'aws-cdk-lib';
import * as fs from 'fs';
import { load } from "js-yaml";
import * as path from "path";
import 'source-map-support/register';
import { TrainingPipeline } from "../lib/stacks/training-pipeline";


const app = new App();

export interface AppConfig extends StackProps{
  readonly repoType: string;
  readonly repoName: string;
  readonly branchName: string;
  readonly githubConnectionArn: string;
  readonly githubRepoOwner: string;
  readonly pipelineAssetsPrefix: string;
  readonly featureGroupName: string;
  readonly assetsBucket: string;
  readonly modelPackageGroupName: string;
  readonly trainingInstanceType: string;
  
}
function getConfig() {
  let configYaml: any = load(fs.readFileSync(path.resolve("./config.yaml"), "utf8"));
  let repoConfigYaml: any = load(fs.readFileSync(path.resolve("../repo_config.yaml"), "utf8"));
  let appConfig: AppConfig = {
      repoType: repoConfigYaml['repoType'],
      repoName: repoConfigYaml['repoName'],
      branchName: repoConfigYaml['branchName'],
      githubConnectionArn: repoConfigYaml['githubConnectionArn'],
      githubRepoOwner: repoConfigYaml['githubRepoOwner'],
      pipelineAssetsPrefix: configYaml['pipelineAssetsPrefix'],
      featureGroupName: Fn.importValue('mlopsfeatureGroup'),
      assetsBucket: Fn.importValue('mlopsDataBucket'),
      modelPackageGroupName: Fn.importValue('mlopsModelPackageGroup'),
      trainingInstanceType: configYaml['trainingInstanceType']
  };
  return appConfig;
}

async function Main() {

  let appConfig: AppConfig = getConfig();
  new TrainingPipeline(app, 'MLOps-Training-Infra-Stack', appConfig);
  app.synth();
}
Main();

