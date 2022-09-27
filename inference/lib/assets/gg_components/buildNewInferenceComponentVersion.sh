#!/bin/bash -x

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
export COMPONENT_VERSION=$(python3 $SCRIPT_DIR/../../assets/gg_component_version_helper/setup.py com.qualityinspection)
export TARGET_ARN=$(aws iot describe-thing --thing-name $IOT_THING_NAME  --output text --query 'thingArn')

OUT_PATH=$SCRIPT_DIR/../../cdk.out/greengrass_dev
rm -rf ${OUT_PATH} && mkdir -p ${OUT_PATH}/artifacts ${OUT_PATH}/recipes

# zip and upload artifact
cd $SCRIPT_DIR/../../assets/gg_components/artifacts/qualityinspection/; zip -r $SCRIPT_DIR/../../cdk.out/greengrass_dev/artifacts/qualityinspection.zip . -x "*.DS_Store"
aws s3 cp ${OUT_PATH}/artifacts/qualityinspection.zip s3://${ARTIFACT_BUCKET}/edge/artifacts/qualityinspection/${COMPONENT_VERSION}/

# create recipe for component version
sed "s/BUCKET_NAME/${ARTIFACT_BUCKET}/g;s/COMPONENT_VERSION/${COMPONENT_VERSION}/g" $SCRIPT_DIR/../../assets/gg_components/recipes/com.qualityinspection.json > ${OUT_PATH}/recipes/com.qualityinspection.json

# create component version
aws greengrassv2 create-component-version --inline-recipe fileb://${OUT_PATH}/recipes/com.qualityinspection.json
