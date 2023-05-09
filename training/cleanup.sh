#!/bin/bash
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
SAGEMAKER_PIPELINE="QualityInspectionModelTraining"
MODEL_PACKAGE_GROUP="TagQualityInspectionPackageGroup"

echo "Cleaning up training artifacts"

aws sagemaker delete-pipeline --pipeline-name ${SAGEMAKER_PIPELINE} --no-cli-pager
model_packages=$(aws sagemaker list-model-packages --model-package-group-name $MODEL_PACKAGE_GROUP --query "ModelPackageSummaryList[].ModelPackageArn" --output text)
for package in $model_packages
do
    echo "Deleting model package: $package"
    aws sagemaker delete-model-package --model-package-name $package
done
echo "Deleting model package group: $group"
aws sagemaker delete-model-package-group --model-package-group-name $MODEL_PACKAGE_GROUP

cd $SCRIPT_DIR/../training/ && cdk destroy --all --force
echo "Deleting stack MLOps-Training-SageMaker-Pipeline-Stack"
aws cloudformation delete-stack --stack-name MLOps-Training-SageMaker-Pipeline-Stack --no-cli-pager
aws cloudformation wait stack-delete-complete --stack-name MLOps-Training-SageMaker-Pipeline-Stack --no-cli-pager
