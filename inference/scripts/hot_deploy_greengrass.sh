#!/bin/bash -x

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
ARTIFACT_BUCKET_NAME=$(aws cloudformation describe-stacks --query 'Stacks[?StackName==`MLOps-Init-Stack`] | [0].Outputs[?OutputKey==`mlopsDataBucket`][OutputValue][] ' --output=text)
export COMPONENT_VERSION=$(python3 $SCRIPT_DIR/../lib/assets/gg_component_version_helper/setup.py com.qualityinspection)
export MODEL_VERSION=$(python3 $SCRIPT_DIR/../lib/assets/gg_component_version_helper/setup.py com.qualityinspection.model | awk 'BEGIN{FS=OFS="."} {$3-=1} 1')
export TARGET_ARN=$(aws iot describe-thing --thing-name EdgeThing-MLOps-Inference-Statemachine-Pipeline-Stack  --output text --query 'thingArn')

OUT_PATH=$SCRIPT_DIR/../cdk.out/greengrass_dev
rm -rf ${OUT_PATH} && mkdir -p ${OUT_PATH}/artifacts ${OUT_PATH}/recipes

# zip and upload artifact
cd $SCRIPT_DIR/../lib/assets/gg_components/artifacts/qualityinspection/; zip -r $SCRIPT_DIR/../cdk.out/greengrass_dev/artifacts/qualityinspection.zip . -x "*.DS_Store"
aws s3 cp ${OUT_PATH}/artifacts/qualityinspection.zip s3://${ARTIFACT_BUCKET_NAME}/edge/artifacts/qualityinspection/${COMPONENT_VERSION}/
# create recipe
sed "s/BUCKET_NAME/${ARTIFACT_BUCKET_NAME}/g;s/COMPONENT_VERSION/${COMPONENT_VERSION}/g" $SCRIPT_DIR/../lib/assets/gg_components/recipes/com.qualityinspection.json > ${OUT_PATH}/recipes/com.qualityinspection.json
# create deployment
envsubst < $SCRIPT_DIR/gg-deployment.json > ${OUT_PATH}/gg-deployment.json

# create component version
aws greengrassv2 create-component-version --inline-recipe fileb://${OUT_PATH}/recipes/com.qualityinspection.json

sleep 8
aws greengrassv2 create-deployment --cli-input-json file://${OUT_PATH}/gg-deployment.json
