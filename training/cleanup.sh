#!/bin/bash
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
SAGEMAKER_PIPELINE="TrainingPipeline"

echo "Cleaning up training artifacts"

aws sagemaker delete-pipeline --pipeline-name ${SAGEMAKER_PIPELINE} --no-cli-pager
cd $SCRIPT_DIR/../training/ && cdk destroy --all --force
echo "Deleting stack MLOps-Training-SageMaker-Pipeline-Stack"
aws cloudformation delete-stack --stack-name MLOps-Training-SageMaker-Pipeline-Stack --no-cli-pager
aws cloudformation wait stack-delete-complete --stack-name MLOps-Training-SageMaker-Pipeline-Stack --no-cli-pager
