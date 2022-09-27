import { aws_sagemaker as sagemaker, Fn, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AppConfig } from '../../bin/app'

export interface EdgeManagerConstructProps extends AppConfig{
    coreDeviceIamRole: string
    coreDeviceName: string
}

export class EdgeManagerConstruct extends Construct {

    constructor(scope: Construct, id: string, props: EdgeManagerConstructProps) {
        super(scope, id);

        const deviceFleet = new sagemaker.CfnDeviceFleet(this, 'edge-manager-device-fleet',
            {
                deviceFleetName: `${props.ggProps.deviceFleetName}-${Stack.of(this).stackName}`,
                outputConfig: {
                    s3OutputLocation: `s3://${props.assetsBucket}/edgemanager/`
                },
                roleArn: props.coreDeviceIamRole
            });

        const device = new sagemaker.CfnDevice(this, 'edge-manager-device', {
            deviceFleetName: deviceFleet.ref,
            device: {
                deviceName: `${props.coreDeviceName}`
            }
        })
    }
}

