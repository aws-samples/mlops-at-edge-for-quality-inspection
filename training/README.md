# Training 

This folder contains the cdk app which deploys the training part of the MLOps pipeline. This part of the pipeline is responsible for model building and orchestrated using Amazon SageMaker Pipelines.
It consists of following steps

1. [Processing Step](https://docs.aws.amazon.com/sagemaker/latest/dg/build-and-manage-steps.html#step-type-processing) which loads the latest images and bounding boxes from SageMaker Feature Store and transforms the data into recordio format required for Model training.
2. [Training step](https://docs.aws.amazon.com/sagemaker/latest/dg/build-and-manage-steps.html#step-type-training) for model training using Apache MXNet and Yolov3
3. [Processing Step](https://docs.aws.amazon.com/sagemaker/latest/dg/build-and-manage-steps.html#step-type-processing) to evaluate model against a test set
4. [Register Model Step](https://docs.aws.amazon.com/sagemaker/latest/dg/build-and-manage-steps.html#step-type-register-model) to register model in SageMaker Model Registry if performance is above threshold

This is how the final SageMaker Pipelines workflow looks like:

![../doc/training-workflow.png](../doc/training-workflow.png)
### CI/CD pipeline

In order for the SageMaker Pipelines workflow to run succesfully a number of assets like lambda functions and iam roles need to be deployed beforehand. This deployment is automated using a CDK app. The pipeline is triggered on a schedule as well as on git commit using two pipelines in AWS CodePipeline. This is how the architecture of the CI/CD infrastructure looks like deployed by this CDK app:

![../doc/cicd-architecture-training.jpg](../doc/cicd-architecture-training.jpg)

Note the CodePipeline deployed here is a self-mutating pipeline which updates itself during the run. It is deployed using [CDK pipelines](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.pipelines-readme.html). Checkout [this blog](https://aws.amazon.com/blogs/developer/cdk-pipelines-continuous-delivery-for-aws-cdk-applications/) if you want an intro to CDK pipelines

### repository layout

This is the layout of the training CDK app:

```bash
├── bin
│   └── app.ts                                 - cdk app definition
├── cdk.json                                   - cdk configuration
├── cleanup.sh                                 - cleanup script to delete all relevant resources
├── config.yaml                                - pipeline config, changes to the training workflow are done here
├── lib
│   ├── assets
│   │   ├── docker                             - assets to build custom docker files used in training and processing jobs
│   │   │   ├── Dockerfile                     - Docker file for custom container used in training and processing
│   │   │   ├── evaluate.py                    - script to evaluate model and calulate MaP metric for a given test set
│   │   │   ├── im2rec.py                      - utility script to convert lst files to recordIO format
│   │   │   ├── preprocess.py                  - preprocessing script to load images and bounding boxes from feature store, split dataset and convert to recordio for training
│   │   │   └── train_yolo.py                  - script to train yolov3 model to detect scratches in an image
│   │   └── sagemaker_pipeline                 - assets related to SageMaker pipeline definition
│   │       ├── pipeline_helper.py             - helper script to work with sagemaker pipelines API
│   │       ├── requirements.txt               - requirements definition for code build job which starts sagemaker pipeline
│   │       └── construct_and_run_pipeline.py  - script which defines pipeline and kicks off execution
│   ├── constructs
│   │   └── training-pipeline-assets.ts        - assets required to execute model building pipeline
│   └── stacks
│       ├── training-pipeline.ts               - stack which defines asset build code pipeline
│       └── training-sagemaker-pipeline.ts     - stack which defines pipeline responsible for sagemaker pipelines execution
├── package.json                               - node dependency definition
└── tsconfig.json                              - typescript config
```

### Changing configuration

You can change the behaviour of the training pipeline by changing the values in in [config.yaml](config.yaml). Checkout the file to learn more about properties you can change.