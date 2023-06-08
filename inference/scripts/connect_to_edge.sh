#!/bin/bash

INSTANCE_ID=$(aws ec2 describe-instances --filters 'Name=tag:Name,Values=Greengrass-MLOps-Inference-Statemachine-Pipeline-Stack' 'Name=instance-state-name,Values=running' --output text --query 'Reservations[*].Instances[*].InstanceId')
aws ssm  start-session --target ${INSTANCE_ID}
	
