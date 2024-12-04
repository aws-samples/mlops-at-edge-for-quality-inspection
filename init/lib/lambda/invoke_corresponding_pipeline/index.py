import boto3
import os

codecommit_client = boto3.client('codecommit')
codepipeline_client = boto3.client('codepipeline')

training_pipeline_name = os.environ["TRAINING_PIPELINE_NAME"]
inference_pipeline_name = os.environ["INFERENCE_PIPELINE_NAME"]
labeling_pipeline_name = os.environ["LABELING_PIPELINE_NAME"]

pipelines_map = {
    "training": training_pipeline_name,
    "inference": inference_pipeline_name,
    "labeling": labeling_pipeline_name,
}

def lambda_handler(event, context):
    # Extract commits
    old_commit_id = event["detail"]["oldCommitId"]
    new_commit_id = event["detail"]["commitId"]
    # Get commit differences
    codecommit_response = codecommit_client.get_differences(
        repositoryName=os.environ["REPOSITORY_NAME"],
        beforeCommitSpecifier=str(old_commit_id),
        afterCommitSpecifier=str(new_commit_id)
    )
    # Search commit differences for files to ignore
    print(codecommit_response["differences"])
    all_changed_files = set()
    for difference in codecommit_response["differences"]:
        if "afterBlob" in difference:
            file_name = difference["afterBlob"]["path"]
            all_changed_files.add(file_name)
    
    invoked_pipeline = set()
    all_folders = set(pipelines_map.keys())
    print(f"Changed files are : {all_changed_files}")
    for file in all_changed_files:
        iteration = all_folders - invoked_pipeline
        for folder_name in iteration:
            if folder_name in file.split("/"):
                invoked_pipeline.add(folder_name)
                print(f"Starting pipeline {pipelines_map[folder_name]}")
                codepipeline_response = codepipeline_client.start_pipeline_execution(name=pipelines_map[folder_name])
                print(codepipeline_response)
                break
    