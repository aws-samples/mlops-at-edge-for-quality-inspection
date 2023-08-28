import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import { aws_lambda as lambda, aws_logs as logs, aws_iam as iam, aws_s3 as s3, aws_s3_assets as s3_assets, aws_codecommit as codecommit, aws_s3_deployment as s3deploy, aws_sagemaker as sagemaker, CfnOutput, CustomResource, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CompositePrincipal, ManagedPolicy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, DockerImageCode, DockerImageFunction } from 'aws-cdk-lib/aws-lambda';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Rule, EventPattern } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import * as path from "path";
import { AppConfig } from '../../bin/app';
export class LabelingInitStack extends Stack {

    readonly dataBucket: s3.Bucket;
    readonly dataBucketOutput: CfnOutput;
    readonly modelPackageGroup: sagemaker.CfnModelPackageGroup;
    readonly featureGroup: sagemaker.CfnFeatureGroup;
    readonly code_repo: codecommit.Repository;

    constructor(scope: Construct, id: string, props: AppConfig) {
        super(scope, id, props);

        if (props.repoType == "CODECOMMIT"){
            this.code_repo = this.seedCodeCommitRepo(props.repoName, props.branchName)
            this.createLambdaInvokingPipeline(this.code_repo) 
        }
        this.dataBucket = this.createAssetsBucket()
        const seedAssetsRole = this.createSeedAssetsRole()
        const bucketDeployment: s3deploy.BucketDeployment = this.seedInitialAssetsToBucket(this.dataBucket)
        this.featureGroup = this.seed_labels_to_feature_store(seedAssetsRole, this.dataBucket, bucketDeployment, props)
        this.modelPackageGroup = this.createModelPackageGroup(props)

        new CfnOutput(this, 'modelPackageGroup', {
            value: this.modelPackageGroup.modelPackageGroupName,
            description: 'The name of the modelpackage group where models are stored in sagemaker model registry',
            exportName: 'mlopsModelPackageGroup'
        })


        new CfnOutput(this, 'mlopsfeatureGroup', {
            value: this.featureGroup.featureGroupName,
            description: 'The name of the feature group where features are stored in feature store',
            exportName: 'mlopsfeatureGroup'
        })

        new CfnOutput(this, 'mlopsDataBucket', {
            value: this.dataBucket.bucketName,
            description: 'The Name of the data bucket',
            exportName: 'mlopsDataBucket'
        })
    }

    seedCodeCommitRepo(repoName: string, branchName: string) {

        //only uploading minimal code from this repo for the stack to work, excluding seed assets and doc
        const directoryAsset = new s3_assets.Asset(this, "SeedCodeAsset", {
            path: path.join(__dirname, "../../.."),
            exclude: ['*.js', 'node_modules', 'doc', '*.d.ts', 'cdk.out', 'model.tar.gz', '.git', '.python-version']

        });
        const repo = new codecommit.Repository(this, 'Repository', {
            repositoryName: repoName,
            code: codecommit.Code.fromAsset(directoryAsset, branchName)
        })
        return repo
    }
    createAssetsBucket() {
        // create default bucker where all assets are stored
        const dataBucket = new s3.Bucket(this, 'LabelingDataBucket', {
            bucketName: "mlops-" + Stack.of(this).account,
            publicReadAccess: false,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            cors: [{
                allowedHeaders: [],
                allowedMethods: [s3.HttpMethods.GET],
                allowedOrigins: ['*'],
            }],
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            serverAccessLogsPrefix: 'access-logs'
        });

        // Bucket policy to deny access to HTTP requests
        const myBucketPolicy = new iam.PolicyStatement({
            effect: iam.Effect.DENY,
            actions: ["s3:*"],
            resources: [dataBucket.bucketArn, dataBucket.arnForObjects("*")],
            principals: [new iam.AnyPrincipal()],
            conditions: { "Bool": { "aws:SecureTransport": false } }
        });

        // Allow Cfn exec and deploy permissions
        const cfnBucketPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["s3:*"],
            resources: [dataBucket.bucketArn, dataBucket.arnForObjects("*")],
            principals: [new ServicePrincipal('cloudformation.amazonaws.com')]
        })

        // Allow cdk roles to read/write permissions
        const cdkBucketPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["s3:*"],
            resources: [dataBucket.bucketArn, dataBucket.arnForObjects("*")],
            principals: [new iam.ArnPrincipal(
                `arn:aws:iam::${Stack.of(this).account}:role/cdk-hnb659fds-deploy-role-${Stack.of(this).account}-${Stack.of(this).region}`
              )]
        })
        
        dataBucket.addToResourcePolicy(myBucketPolicy);
        dataBucket.addToResourcePolicy(cfnBucketPolicy);
        dataBucket.addToResourcePolicy(cdkBucketPolicy);

        return dataBucket
    }

    seedInitialAssetsToBucket(dataBucket: s3.Bucket) {
        // deploy assets required by the pipeline, like the dataset and templates for labeling jobs
        return new s3deploy.BucketDeployment(this, 'AssetInit', {
            memoryLimit: 1024,
            sources: [s3deploy.Source.asset(path.join('./lib/assets'))],
            destinationBucket: dataBucket,
            destinationKeyPrefix: 'pipeline/assets',

        });
    }

    createSeedAssetsRole() {

        const bucketAccess = new PolicyDocument({
            statements: [
                new PolicyStatement({
                    resources: [`arn:aws:s3:::${this.dataBucket.bucketName}/*`, `arn:aws:s3:::${this.dataBucket.bucketName}`],
                    actions: ['s3:*']
                }),
                new PolicyStatement({
                    actions: ['sagemaker:PutRecord', 'sagemaker:CreateModelPackage'],
                    resources: ['*']
                }),
                new PolicyStatement({
                    actions: ['ecr:*'],
                    resources: ['*']
                })
            ]
        });

        return new Role(this, 'FeatureGroupRole', {
            assumedBy: new CompositePrincipal(
                new ServicePrincipal('sagemaker.amazonaws.com'),
                new ServicePrincipal('lambda.amazonaws.com')
            ),
            inlinePolicies: {
                bucketAccess: bucketAccess
            },
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFeatureStoreAccess'),
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ]
        })
    }

    seed_labels_to_feature_store(role: Role, dataBucket: Bucket, bucketDeployment: s3deploy.BucketDeployment, props: AppConfig) {

        const offlineStoreConfig: any = {
            "S3StorageConfig": {
                "S3Uri": `s3://${dataBucket.bucketName}/feature-store/`
            }
        };

        const featureGroup = new sagemaker.CfnFeatureGroup(this, 'MyCfnFeatureGroup', {
            eventTimeFeatureName: 'event_time',
            featureDefinitions: [{
                featureName: 'source_ref',
                featureType: 'String',
            },
            {
                featureName: 'image_width',
                featureType: 'Integral',
            },
            {
                featureName: 'image_height',
                featureType: 'Integral',
            },
            {
                featureName: 'image_depth',
                featureType: 'Integral',
            },
            {
                featureName: 'annotations',
                featureType: 'String',
            },
            {
                featureName: 'event_time',
                featureType: 'Fractional',
            },
            {
                featureName: 'labeling_job',
                featureType: 'String',
            },
            {
                featureName: 'status',
                featureType: 'String',
            }
            ],
            featureGroupName: 'tag-quality-inspection',
            recordIdentifierFeatureName: 'source_ref',
            description: 'Stores bounding box dataset for quality inspection',
            offlineStoreConfig: offlineStoreConfig,
            roleArn: role.roleArn,

        });

        const seedLabelsFunction = new DockerImageFunction(this, 'SeedLabelsToFeatureStoreFunction', {
            code: DockerImageCode.fromImageAsset(path.join(__dirname, '../lambda/seed_labels_to_feature_store')),
            architecture: Architecture.X86_64,
            functionName: "SeedLabelsToFeatureStoreFunction",
            memorySize: 1024,
            role: role,
            timeout: Duration.seconds(300),
            logRetention: logs.RetentionDays.ONE_WEEK,
        });

        const customResource = new CustomResource(this, 'SeedLabelsCustomResource', {
            serviceToken: seedLabelsFunction.functionArn,
            properties: {
                feature_group_name: props.featureGroupName,
                labels_uri: `s3://${dataBucket.bucketName}/pipeline/assets/labels/labels.csv`
            }
        });

        featureGroup.node.addDependency(bucketDeployment);
        customResource.node.addDependency(featureGroup);
        return featureGroup
    }

    createModelPackageGroup(props: AppConfig) {

        const cfnModelPackageGroup = new sagemaker.CfnModelPackageGroup(this, 'MyCfnModelPackageGroup', {
            modelPackageGroupName: props.modelPackageGroupName,
            modelPackageGroupDescription: props.modelPackageGroupDescription,
        });

        cfnModelPackageGroup.applyRemovalPolicy(RemovalPolicy.DESTROY)
        return cfnModelPackageGroup
    }
    createLambdaInvokingPipeline(codeRepo: codecommit.Repository){
        const lambdaRole = new Role(this, 'LambdaRole', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
          });
      
          // Add permissions to invoke CodePipeline
          lambdaRole.addToPolicy(
            new PolicyStatement({
              actions: ['codepipeline:StartPipelineExecution', 'cloudwatch:*', 'logs:*', 'codecommit:*'],
              resources: ['*'],
            })
          );
          const lambdaFunction = new lambda_python.PythonFunction(this, 'RunCorrespondingPipelineLambda', {
            entry: 'lib/lambda/invoke_corresponding_pipeline', // required
            runtime: lambda.Runtime.PYTHON_3_8,
            architecture: Architecture.X86_64,
            timeout: Duration.seconds(300),
            handler: 'lambda_handler',
            role: lambdaRole,
            environment: {
              "REPOSITORY_NAME": codeRepo.repositoryName,
              "TRAINING_PIPELINE_NAME": "MlOpsEdge-Training-Infra-Pipeline",
              "LABELING_PIPELINE_NAME": "MlOpsEdge-Labeling-Infra-Pipeline",
              "INFERENCE_PIPELINE_NAME": "MlOpsEdge-Inference-Infra-Pipeline",
            }
          });
    
        const eventPattern: EventPattern = {
            source: ['aws.codecommit'],
            resources: [codeRepo.repositoryArn],
            detailType: ['CodeCommit Repository State Change'],
            detail: {
                event: ['referenceCreated', 'referenceUpdated'],
                referenceName: ['main'], // Change to your desired branch name
            },
        };
    
        new Rule(this, 'CodeCommitEventRule', {
            eventPattern,
            targets: [new LambdaFunction(lambdaFunction)],
        });

    }
}
