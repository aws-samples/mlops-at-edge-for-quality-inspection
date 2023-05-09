# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import asyncio
from json import dumps
from os import getenv, listdir

import awsiot.greengrasscoreipc.client as client
import config_utils
from awscrt.io import (ClientBootstrap, DefaultHostResolver, EventLoopGroup,
                       SocketDomain, SocketOptions)
from awsiot.eventstreamrpc import (Connection, LifecycleHandler,
                                   MessageAmendment)
from awsiot.greengrasscoreipc.model import (
    ConfigurationUpdateEvents, GetConfigurationRequest,
    PublishToIoTCoreRequest, SubscribeToConfigurationUpdateRequest)
from stream_manager import (ExportDefinition, MessageStreamDefinition,
                            ResourceNotFoundException, S3ExportTaskDefinition,
                            S3ExportTaskExecutorConfig, StrategyOnFull,
                            StreamManagerClient)
from stream_manager.util import Util


class IPCUtils:
    def connect(self):
        elg = EventLoopGroup()
        resolver = DefaultHostResolver(elg)
        bootstrap = ClientBootstrap(elg, resolver)
        socket_options = SocketOptions()
        socket_options.domain = SocketDomain.Local
        amender = MessageAmendment.create_static_authtoken_amender(
            getenv("SVCUID"))
        hostname = getenv(
            "AWS_GG_NUCLEUS_DOMAIN_SOCKET_FILEPATH_FOR_COMPONENT")
        connection = Connection(
            host_name=hostname,
            port=8033,
            bootstrap=bootstrap,
            socket_options=socket_options,
            connect_message_amender=amender,
        )
        self.lifecycle_handler = LifecycleHandler()
        connect_future = connection.connect(self.lifecycle_handler)
        connect_future.result(config_utils.TIMEOUT)
        return connection

    def publish_results_to_cloud(self, PAYLOAD):
        r"""
        Ipc client creates a request and activates the operation to publish messages to the IoT core
        with a qos type over a topic.

        :param PAYLOAD: An dictionary object with inference results.
        """
        try:
            request = PublishToIoTCoreRequest(
                topic_name=config_utils.TOPIC,
                qos=config_utils.QOS_TYPE,
                payload=dumps(PAYLOAD).encode(),
            )
            print(PAYLOAD)
            operation = ipc_client.new_publish_to_iot_core()
            operation.activate(request).result(config_utils.TIMEOUT)
            config_utils.logger.info("Publishing results to the IoT core...")
            operation.get_response().result(config_utils.TIMEOUT)
        except Exception as e:
            config_utils.logger.info(
                "Exception occured during publish: {}".format(e.message))

    def upload_to_s3(self, local_image_path, s3_folder):
        try:
            stream_name = config_utils.STREAM_NAME
            bucket_name = config_utils.UPLOAD_BUCKET_NAME

            client = StreamManagerClient()

            # Try deleting the stream (if it exists) so that we have a fresh start
            try:
                client.delete_message_stream(stream_name=stream_name)
            except ResourceNotFoundException:
                pass

            exports = ExportDefinition(
                s3_task_executor=[
                    S3ExportTaskExecutorConfig(
                        identifier="S3TaskExecutor" + stream_name
                    )
                ]
            )

            # Create the message stream with the S3 Export definition.
            client.create_message_stream(
                MessageStreamDefinition(
                    name=stream_name, strategy_on_full=StrategyOnFull.OverwriteOldestData, export_definition=exports
                )
            )

            file_url = "file://%s" % (local_image_path)

            # Append a S3 Task definition and print the sequence number
            s3_export_task_definition = S3ExportTaskDefinition(
                input_url=file_url, bucket=bucket_name, key="{}{}".format(s3_folder, local_image_path.split("/")[-1]))
            config_utils.logger.info(
                "Successfully appended S3 Task Definition to stream with sequence number %d",
                client.append_message(stream_name, Util.validate_and_serialize_to_json_bytes(
                    s3_export_task_definition)),
            )

        except asyncio.TimeoutError:
            config_utils.logger.exception("Timed out while executing")
        except Exception:
            config_utils.logger.exception("Exception while running")
        finally:
            if client:
                client.close()

    def get_configuration(self):
        r"""
        Ipc client creates a request and activates the operation to get the configuration of
        inference component passed in its recipe.

        :return: A dictionary object of DefaultConfiguration from the recipe.
        """
        try:
            get_config_request = GetConfigurationRequest()
            operation = ipc_client.new_get_configuration()
            operation.activate(get_config_request).result(config_utils.TIMEOUT)
            result = operation.get_response().result(config_utils.TIMEOUT)
            return result.value
        except Exception as e:
            config_utils.logger.error(
                "Exception occured during fetching the configuration: {}".format(
                    e.message)
            )
            exit(1)

    def get_config_updates(self):
        r"""
        Ipc client creates a request and activates the operation to subscribe to the configuration changes.
        """
        try:
            config_subscribe_req = SubscribeToConfigurationUpdateRequest()
            subscribe_operation = ipc_client.new_subscribe_to_configuration_update(
                ConfigUpdateHandler()
            )
            parent_subscribe_operation = ipc_client.new_subscribe_to_configuration_update(
                ConfigUpdateHandler()
            )
            subscribe_operation.activate(
                config_subscribe_req).result(config_utils.TIMEOUT)
            subscribe_operation.get_response().result(config_utils.TIMEOUT)
        except Exception as e:
            config_utils.logger.error(
                "Exception occured during fetching the configuration updates: {}".format(
                    e.message)
            )
            exit(1)


class ConfigUpdateHandler(client.SubscribeToConfigurationUpdateStreamHandler):
    r"""
    Custom handle of the subscribed configuration events(steam,error and close).
    Due to the SDK limitation, another request from within this callback cannot to be sent.
    Here, it just logs the event details, updates the updated_config to true.
    """

    def on_stream_event(self, event: ConfigurationUpdateEvents) -> None:
        config_utils.logger.info(event.configuration_update_event)
        with config_utils.condition:
            config_utils.condition.notify()

    def on_stream_error(self, error: Exception) -> bool:
        config_utils.logger.error(
            "Error in config update subscriber - {0}".format(error))
        return False

    def on_stream_closed(self) -> None:
        config_utils.logger.info(
            "Config update subscription stream was closed")


# Get the ipc client
try:
    ipc_client = client.GreengrassCoreIPCClient(IPCUtils().connect())
    config_utils.logger.info("Created IPC client...")
except Exception as e:
    config_utils.logger.error(
        "Exception occured during the creation of an IPC client: {}".format(
            e.message)
    )
    exit(1)
