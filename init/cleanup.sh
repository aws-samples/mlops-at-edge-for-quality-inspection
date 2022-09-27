#!/bin/bash
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
ARTIFACT_BUCKET_NAME=$(aws cloudformation describe-stacks --query 'Stacks[?StackName==`MLOps-Init-Stack`] | [0].Outputs[?OutputKey==`mlopsDataBucket`][OutputValue][] ' --output=text)
MODEL_PACKAGE_GROUP="TagQualityInspectionPackageGroup"

echo "Cleaning up MLOps infrastructure artifacts"
# Cleanup SageMaker Model Registry model packages and model package group
MODEL_PACKAGES=$(aws sagemaker list-model-packages --model-package-group-name ${MODEL_PACKAGE_GROUP} --output text | cut -f4)
for package in ${MODEL_PACKAGES}
do
    echo Deleting model package $package
    aws sagemaker delete-model-package --model-package-name  $package
    sleep 1
done
aws sagemaker delete-model-package-group --model-package-group-name ${MODEL_PACKAGE_GROUP}

# cleanup artifacts bucket
aws s3 rm s3://${ARTIFACT_BUCKET_NAME} --recursive

cd $SCRIPT_DIR/../init/ && cdk destroy --all --force
