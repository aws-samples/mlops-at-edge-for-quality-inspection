from __future__ import print_function

import logging
from collections import namedtuple
from io import StringIO
from urllib.parse import urlparse
from botocore.exceptions import ClientError
from crhelper import CfnResource
import boto3

logger = logging.getLogger(__name__)

helper = CfnResource(json_logging=False, log_level='DEBUG',
                     boto_level='CRITICAL', sleep_on_delete=120, ssl_verify=None)

LambdaConfig = namedtuple(
    'LambdaConfig', 'model_uri model_package_group_name')

try:
    # initialize clients
    s3 = boto3.resource('s3')
    s3_client = boto3.client('s3')
    sagemaker_client = boto3.client("sagemaker")
    region = boto3.session.Session().region_name
    logger.info(f"Running in Region {region}")
except Exception as e:
    helper.init_failure(e)


@helper.create
def create(event, context):

    logger.info(
        f"seed inital model called {event}")
    lambda_config = initialize_lambda_config(event)
    logger.info(f"Finished with lambda config {lambda_config}")
    register_model(lambda_config.model_uri,
                   lambda_config.model_package_group_name)
    return f"Successfully registered model in model registry"


def register_model(model_uri, model_package_group_name):
    """
    Register the model with the model registry.
    """

    modelpackage_inference_specification = {
        "InferenceSpecification": {
            "Containers": [
                {
                    "Image": f"763104351884.dkr.ecr.{region}.amazonaws.com/mxnet-inference:1.8.0-gpu-py37",
                    "ModelDataUrl": model_uri
                }
            ],
            "SupportedContentTypes": ["image/jpeg"],
            "SupportedResponseMIMETypes": ["application/json"],
        }
    }

    # Alternatively, you can specify the model source like this:
    # modelpackage_inference_specification["InferenceSpecification"]["Containers"][0]["ModelDataUrl"]=model_url

    create_model_package_input_dict = {
        "ModelPackageGroupName": model_package_group_name,
        "ModelPackageDescription": "Yolov3 model with mobilenet base",
        "ModelApprovalStatus": "Approved",
        "CustomerMetadataProperties": {
            "Value": "myvalue"
        }
    }
    create_model_package_input_dict.update(
        modelpackage_inference_specification)
    create_model_package_response = sagemaker_client.create_model_package(
        **create_model_package_input_dict)
    model_package_arn = create_model_package_response["ModelPackageArn"]
    logger.info('ModelPackage Version ARN : {}'.format(model_package_arn))


@helper.delete
def delete(event, context):
    logger.info("Deletion of model not implemented")


def initialize_lambda_config(event: dict):

    if "model_uri" in event['ResourceProperties']:
        model_uri = event['ResourceProperties']["model_uri"]
    else:
        raise Exception("No model_uri specified in lambda event")

    if "model_package_group_name" in event['ResourceProperties']:
        model_package_group_name = event['ResourceProperties']["model_package_group_name"]
    else:
        raise Exception("No model_package_group_name specified in lambda event")

    return LambdaConfig(model_uri, model_package_group_name)


def handler(event, context):
    helper(event, context)
