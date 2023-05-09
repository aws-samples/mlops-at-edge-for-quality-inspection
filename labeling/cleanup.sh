#!/bin/bash
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
FEATURE_STORE_DB="sagemaker_featurestore"

echo "Cleaning up labeling artifacts"
# Cleanup labeling stack artifacts
FEATURE_STORE_TABLES=($(aws glue get-tables --database-name sagemaker_featurestore --expression "^tag-quality-inspection*" | awk -F: /Name/'{gsub(/[",]/,""); print $2}' | awk /tag-quality-inspection/{print}))
for table in ${FEATURE_STORE_TABLES}
do
    echo Deleting $table from Glue database $FEATURE_STORE_DB
    aws glue delete-table --database-name $FEATURE_STORE_DB --name $table
done
# echo Deleting Glue database: $FEATURE_STORE_DB
# aws glue delete-database --name $FEATURE_STORE_DB
cd $SCRIPT_DIR/../labeling/ && cdk destroy --all --force
echo "Deleting stack MLOps-Labeling-Statemachine-Pipeline-Stack"
aws cloudformation delete-stack --stack-name MLOps-Labeling-Statemachine-Pipeline-Stack
aws cloudformation wait stack-delete-complete --stack-name MLOps-Labeling-Statemachine-Pipeline-Stack
aws cloudformation delete-stack --stack-name MLOps-Labeling-Infra-Stack
aws cloudformation wait stack-delete-complete --stack-name MLOps-Labeling-Infra-Stack
