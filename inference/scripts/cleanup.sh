#!/bin/bash

echo "Cleaning up inference artifacts"

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
CERTIFICATE_ARN=$(aws iot list-targets-for-policy --policy-name BlogPostGGV2IoTThingPolicy | jq -r '.targets[0]')
CERTIFICATE_ID=$(echo "$CERTIFICATE_ARN" | cut -f2 -d"/")
THING_NAME="EdgeThing-MLOps-Inference-Statemachine-Pipeline-Stack"
GG_CORE_DEVICE="EdgeThing-MLOps-Inference-Statemachine-Pipeline-Stack"

aws iot update-certificate --certificate-id "$CERTIFICATE_ID" --new-status INACTIVE
aws iot detach-thing-principal --thing-name ${THING_NAME} --principal "$CERTIFICATE_ARN"
aws iot detach-policy --policy-name BlogPostGGV2IoTThingPolicy --target "$CERTIFICATE_ARN"
aws iot detach-policy --policy-name GreengrassTESCertificatePolicyBlogPostGGCoreTokenExchangeRoleAlias --target "$CERTIFICATE_ARN"
aws iot delete-certificate --certificate-id "$CERTIFICATE_ID"
aws iot delete-role-alias --role-alias SageMakerEdge-devicefleet-MLOps-Inference-Statemachine-Pipeline-Stack
aws greengrassv2 delete-core-device --core-device-thing-name ${GG_CORE_DEVICE}
GG_COMPONENTS=($(aws greengrassv2 list-components --output text | awk -F"\t" '$1=="COMPONENTS" {print $2}' | awk '/com.qualityinspection/'))
for component in ${GG_COMPONENTS}
do
    COMPONENT_VERSIONS=($(aws greengrassv2 list-component-versions --arn $component --output text | awk -F"\t" '{print $4}'))
    for version in ${COMPONENT_VERSIONS}
    do
        echo Deleting $component:versions:$version
        aws greengrassv2 delete-component --arn $component:versions:$version
    done
done
cd $SCRIPT_DIR/.. && cdk destroy --all --force
echo "Deleting stack MLOps-Inference-Statemachine-Pipeline-Stack"
aws cloudformation delete-stack --stack-name MLOps-Inference-Statemachine-Pipeline-Stack
aws cloudformation wait stack-delete-complete --stack-name MLOps-Inference-Statemachine-Pipeline-Stack
