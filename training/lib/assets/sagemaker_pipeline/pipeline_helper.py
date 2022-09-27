import json
import logging

logging.basicConfig(level=logging.INFO)


def run_pipeline(pipeline=None, parameters=None, description="SageMaker pipeline", role=None, update_only=False):

    parsed = json.loads(pipeline.definition())
    logging.info(json.dumps(parsed, indent=2, sort_keys=True))

    upsert_response = pipeline.upsert(
        role_arn=role, description=description
    )
    logging.info(
        "\n###### Created/Updated SageMaker Pipeline: Response received:")
    logging.info(upsert_response)

    if update_only:
        logging.info("Update only flag set, not kicking off pipeline")
        return

    execution = pipeline.start(
        parameters=parameters
    )
    logging.info(
        f"\n###### Execution started with PipelineExecutionArn: {execution.arn}")

    logging.info("Waiting for the execution to finish...")
    # Waits for 1 day with 30 second intervals
    execution.wait(delay=30, max_attempts=120*24)
    logging.info("\n#####Execution completed.")
