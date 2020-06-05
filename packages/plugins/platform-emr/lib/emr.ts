import * as cdk from '@aws-cdk/core';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as sfnTasks from '@aws-cdk/aws-stepfunctions-tasks';
import * as iam from '@aws-cdk/aws-iam';
import * as s3 from '@aws-cdk/aws-s3';
// eslint-disable-next-line
import * as ec2 from '@aws-cdk/aws-ec2';
import {ConfigConstant as CC} from '@moonset/util';
// eslint-disable-next-line
import {PluginHost, MoonsetConstants as MC} from '@moonset/executor';
import {StringAsset, FileAsset} from './asset';
import {HiveTaskBuilder} from "../../../executor/HiveTask/HiveTaskBuilder";

const EMR_STACK = 'MoonsetEmrStack';
const EMR_EC2_ROLE = 'MoonsetEmrEc2Role';
const EMR_EC2_PROFILE = 'MoonsetEmrEc2Profile';
const EMR_ROLE = 'MoonsetEmrRole';
const SCRIPT_RUNNER =
    's3://elasticmapreduce/libs/script-runner/script-runner.jar';


export = {
  version: '1',
  plugin: 'platform',
  type: 'emr',
  taskType: ['hive', 'spark'],

  init(host: PluginHost, settings: any) {
    const c = host.constructs;

    const props = {
      id: host.id,
      emrApplications: ['Hive', 'Spark'],
    };

    c[EMR_STACK] = new cdk.Stack(<cdk.App>c[MC.CDK_APP], EMR_STACK, {
      env: {
        account: process.env[CC.WORKING_ACCOUNT],
        region: process.env[CC.WORKING_REGION],
      },
    });

    // eslint-disable-next-line
    const ec2Role = new iam.Role(<cdk.Stack>c[EMR_STACK], EMR_EC2_ROLE, {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    ec2Role.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AmazonElasticMapReduceforEC2Role'));
    ec2Role.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName(
            'AmazonSSMManagedInstanceCore'));
    ec2Role.addToPolicy(
        new iam.PolicyStatement({
          actions: ['kms:*'],
          resources: ['*'],
        }));
    ec2Role.addToPolicy(
        new iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          resources: ['*'],
        }));

    // eslint-disable-next-line
    new iam.CfnInstanceProfile(<cdk.Stack>c[EMR_STACK], EMR_EC2_PROFILE, {
      roles: [ec2Role.roleName],
      instanceProfileName: ec2Role.roleName,
    });

    const emrRole = new iam.Role(<cdk.Stack>c[EMR_STACK], EMR_ROLE, {
      assumedBy: new iam.ServicePrincipal('elasticmapreduce.amazonaws.com'),
    });

    emrRole.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AmazonElasticMapReduceRole'));

    // eslint-disable-next-line
    new iam.CfnServiceLinkedRole(<cdk.Stack>c[EMR_STACK], 'AWSServiceRoleForEMRCleanup', {
      awsServiceName: 'elasticmapreduce.amazonaws.com',
      // eslint-disable-next-line
      description: 'Allows EMR to terminate instances and delete resources from EC2 on your behalf.',
    });

    const emrSettings = new sfn.Pass(<cdk.Stack>c[MC.SF_STACK], 'emrSettings', {
      result: sfn.Result.fromObject({
        ClusterName: `MoonsetEMR-${props.id}`,
      }),
      resultPath: '$.EmrSettings',
    });

    host.commands.push(emrSettings);

    const emrSg = <ec2.SecurityGroup>c[MC.VPC_SG];
    const serviceSg = new ec2.SecurityGroup(c[MC.INFRA_STACK], 'serviceSg', {
      vpc: <ec2.Vpc>c[MC.VPC],
    });
    // To prevent AWS EMR auto create ingress/egress rule.
    serviceSg.addEgressRule(emrSg, ec2.Port.tcp(8443));
    emrSg.addIngressRule(serviceSg, ec2.Port.tcp(8443));

    const emrLogBucket = new s3.Bucket(c[MC.SF_STACK], 'emrLogBucket', {});
    // eslint-disable-next-line
    const emrCreateTask = new sfn.Task(<cdk.Stack>c[MC.SF_STACK], 'emrCluster', {
      task: new sfnTasks.EmrCreateCluster({
        visibleToAllUsers: true,
        logUri: `s3://${emrLogBucket.bucketName}/emr_logs`,
        clusterRole: ec2Role,
        name: sfn.Data.stringAt('$.EmrSettings.ClusterName'),
        serviceRole: emrRole,
        tags: [
          {'key': MC.TAG_MOONSET_TYPE, 'value': MC.TAG_MOONSET_TYPE_EMR},
          {'key': MC.TAG_MOONSET_ID, 'value': props.id},
        ],
        releaseLabel: settings.releaseLabel || 'emr-5.29.0',
        applications: props.emrApplications.map((x) =>{
          return {name: x};
        }),
        instances: {
          instanceCount: settings.instanceCount || 3,
          masterInstanceType: 'm5.xlarge',
          slaveInstanceType: 'm5.xlarge',
          ec2SubnetId: (<ec2.Vpc>c[MC.VPC]).privateSubnets[0].subnetId,
          emrManagedMasterSecurityGroup: emrSg.securityGroupId,
          emrManagedSlaveSecurityGroup: emrSg.securityGroupId,
          serviceAccessSecurityGroup: serviceSg.securityGroupId,
        },
        integrationPattern: sfn.ServiceIntegrationPattern.SYNC,
        configurations: settings.configurations,
      }),
      resultPath: '$.EmrSettings',
    });

    host.commands.push(emrCreateTask);
  },

  task(host: PluginHost, type: string, task: any) {
    const c = host.constructs;
    if (type === 'hive') {
      const emrTask = HiveTaskBuilder.createHiveTask(<cdk.Stack>c[MC.SF_STACK], task.hive)
      host.commands.push(emrTask);
    }
  },
}

