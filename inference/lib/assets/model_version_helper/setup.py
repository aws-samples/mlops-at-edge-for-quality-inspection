import boto3
from botocore.exceptions import ClientError

sm_client = boto3.client("sagemaker")
ssm_client = boto3.client('ssm')

def get_approved_package(model_package_group_name):
    """Gets the latest approved model package for a model package group.

    Args:
        model_package_group_name: The model package group name.

    Returns:
        The SageMaker Model Package ARN.
    """
    try:
        # Get the latest approved model package
        response = sm_client.list_model_packages(
            ModelPackageGroupName=model_package_group_name,
            ModelApprovalStatus="Approved",
            SortBy="CreationTime",
            MaxResults=100,
        )
        approved_packages = response["ModelPackageSummaryList"]

        # Fetch more packages if none returned with continuation token
        while len(approved_packages) == 0 and "NextToken" in response:
            response = sm_client.list_model_packages(
                ModelPackageGroupName=model_package_group_name,
                ModelApprovalStatus="Approved",
                SortBy="CreationTime",
                MaxResults=100,
                NextToken=response["NextToken"],
            )
            approved_packages.extend(response["ModelPackageSummaryList"])

        # Return error if no packages found
        if len(approved_packages) == 0:
            error_message = (
                f"No approved ModelPackage found for ModelPackageGroup: {model_package_group_name}"
            )
            raise Exception(error_message)

        # Return the pmodel package arn
        model_package_arn = approved_packages[0]["ModelPackageArn"]
        return model_package_arn
    except ClientError as e:
        error_message = e.response["Error"]["Message"]
        raise Exception(error_message)

def handler(event, context):
    print(event)
    model_package_group_name = event["ModelPackageGroupName"]
    if event["invokationSource"] == "CodeBuild":
        latest_model_arn = get_approved_package(model_package_group_name)
    else:
        latest_model_arn = event["modelArn"]
    
    model_details = sm_client.describe_model_package(ModelPackageName=latest_model_arn)
    ssm_client.put_parameter(Name="/deployed-model/version",Value=str(model_details["ModelPackageVersion"]), Overwrite=True, Type="String")
    print(model_details)
    return {"ModelUrl": model_details["InferenceSpecification"]["Containers"][0]["ModelDataUrl"]}


if __name__ == '__main__':
    invoke_event = {"ModelPackageGroupName": "TagQualityInspectionPackageGroup", "invokationSource": "CodeBuild"}
    result = handler(invoke_event, None)
    print(result['ModelUrl'])
