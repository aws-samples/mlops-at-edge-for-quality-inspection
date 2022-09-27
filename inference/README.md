# Inference 

This folder containts the cdk app managing the the deployment of the model onto the edge device for inference. As part of this the model is compiled, packaged and deployed to a EC2 instance running AWS IoT Greengrass. The EC2 instance simulates the edge device in this sample. The model is managed using SageMaker Edge Manager utilizing the [SageMaker Edge Manager greengrass component](https://docs.aws.amazon.com/greengrass/v2/developerguide/sagemaker-edge-manager-component.html). Inference code and model are deployed using custom greengrass components.

This is how the final AWS Step Functions workflow looks like:

![../doc/training-workflow.png](../doc/training-workflow.png)
### CI/CD pipeline

In order for the SageMaker Pipelines workflow to run succesfully a number of assets like lambda functions and iam roles need to be deployed beforehand. This deployment is automated using a CDK app. The pipeline is triggered on a schedule as well as on git commit using two pipelines in AWS CodePipeline. This is how the architecture of the CI/CD infrastructure looks like deployed by this CDK app:

![../doc/cicd-architecture-training.jpg](../doc/cicd-architecture-training.jpg)

Note the CodePipeline deployed here is a self-mutating pipeline which updates itself during the run. It is deployed using [CDK pipelines](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.pipelines-readme.html). Checkout [this blog](https://aws.amazon.com/blogs/developer/cdk-pipelines-continuous-delivery-for-aws-cdk-applications/) if you want an intro to CDK pipelines

### repository layout

This is the layout of the inference CDK app:

```bash
├── Makefile
├── README.md
├── bin
│   └── app.ts
├── cdk.json
├── config.yaml
├── lib
│   ├── assets
│   │   ├── gg_component_version_helper
│   │   └── gg_components
│   │       ├── artifacts
│   │       │   └── qualityinspection
│   │       │       ├── IPCUtils.py
│   │       │       ├── agent.proto
│   │       │       ├── agent_pb2.py
│   │       │       ├── agent_pb2_grpc.py
│   │       │       ├── config_utils.py
│   │       │       ├── create_grpc_stubs.sh
│   │       │       ├── inference.py
│   │       │       ├── installer.sh
│   │       │       ├── prediction_utils.py
│   │       │       ├── sample_images
│   │       │       └── stream_manager
│   │       ├── buildNewInferenceComponentVersion.sh
│   │       └── recipes
│   │           └── com.qualityinspection.json
│   ├── constructs
│   │   ├── edge-cicd-pipeline.ts
│   │   ├── edge-deployment-orchestration.ts
│   │   ├── edge-manager.ts
│   │   ├── gg-inference-component-build.ts
│   │   ├── gg-on-ec2.ts
│   │   └── gg-prerequisites.ts
│   └── stacks
│       ├── inference-pipeline.ts
│       └── inference.ts
├── package-lock.json
├── package.json
├── scripts
│   ├── cleanup.sh
│   ├── connect_to_edge.sh
│   ├── gg-deployment.json
│   └── hot_deploy_greengrass.sh
└── tsconfig.json
```

### Changing configuration

You can change the behaviour of the training pipeline by changing the values in in [config.yaml](config.yaml). Checkout the file to learn more about properties you can change.