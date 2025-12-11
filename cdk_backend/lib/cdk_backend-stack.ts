import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as amplify from '@aws-cdk/aws-amplify-alpha';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class CdkBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    const PDF_TO_PDF_BUCKET = this.node.tryGetContext('PDF_TO_PDF_BUCKET') || "Null";
    const PDF_TO_HTML_BUCKET = this.node.tryGetContext('PDF_TO_HTML_BUCKET') || "Null";

    // Validate that at least one bucket is provided
    if (!PDF_TO_PDF_BUCKET && !PDF_TO_HTML_BUCKET) {
      throw new Error(
        "At least one bucket name is required! Pass using -c PDF_TO_PDF_BUCKET=<name> or -c PDF_TO_HTML_BUCKET=<name>"
      );
    }

    // Import buckets independently
    let pdfBucket: s3.IBucket | undefined;
    let htmlBucket: s3.IBucket | undefined;

    if (PDF_TO_PDF_BUCKET) {
      pdfBucket = s3.Bucket.fromBucketName(this, 'PDFBucket', PDF_TO_PDF_BUCKET);
      console.log(`Using PDF-to-PDF bucket: ${pdfBucket.bucketName}`);
    }

    if (PDF_TO_HTML_BUCKET) {
      htmlBucket = s3.Bucket.fromBucketName(this, 'HTMLBucket', PDF_TO_HTML_BUCKET);
      console.log(`Using PDF-to-HTML bucket: ${htmlBucket.bucketName}`);
    }

    // Use the first available bucket as the main bucket for other resources
    const mainBucket = pdfBucket || htmlBucket!;
    console.log(`Using main bucket for other resources: ${mainBucket.bucketName}`);

    // --------- Create DynamoDB Table for Job Tracking ----------
    const jobsTable = new dynamodb.Table(this, 'PDFJobsTable', {
      tableName: 'pdf-accessibility-jobs',
      partitionKey: { name: 'job_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires_at',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI for querying user's jobs
    jobsTable.addGlobalSecondaryIndex({
      indexName: 'user_sub-created_at-index',
      partitionKey: { name: 'user_sub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --------- Create Amplify App for Manual Deployment ----------
    const amplifyApp = new amplify.App(this, 'pdfui-amplify-app', {
      description: 'PDF Accessibility UI - Manual Deployment',
      // No sourceCodeProvider for manual deployment
    });

    // Create main branch for manual deployment
    const mainBranch = amplifyApp.addBranch('main', {
      autoBuild: false, // Manual deployment
      stage: 'PRODUCTION'
    });

    // Add redirect rules for SPA routing
    amplifyApp.addCustomRule(new amplify.CustomRule({
      source: '</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json)$)([^.]+$)/>',
      target: '/index.html',
      status: amplify.RedirectStatus.REWRITE
    }));

    amplifyApp.addCustomRule(new amplify.CustomRule({
      source: '/home',
      target: '/index.html',
      status: amplify.RedirectStatus.REWRITE
    }));

    amplifyApp.addCustomRule(new amplify.CustomRule({
      source: '/callback',
      target: '/index.html',
      status: amplify.RedirectStatus.REWRITE
    }));

    amplifyApp.addCustomRule(new amplify.CustomRule({
      source: '/app',
      target: '/index.html',
      status: amplify.RedirectStatus.REWRITE
    }));

    // Use existing domain prefix if stack is already deployed (from context or default)
    const domainPrefix = this.node.tryGetContext('DOMAIN_PREFIX') || 'pdf-ui-auth2p55do'; // must be globally unique in that region
    const Default_Group = 'DefaultUsers';
    const Amazon_Group = 'AmazonUsers';
    const Admin_Group = 'AdminUsers';
    const appUrl = `https://main.${amplifyApp.appId}.amplifyapp.com`;
    
    // Create the Lambda role first with necessary permissions
    const postConfirmationLambdaRole = new iam.Role(this, 'PostConfirmationLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    postConfirmationLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminAddUserToGroup',
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents'
        ],
        resources: ['*']  // You can restrict this further if needed
      })
    );

    // Create the Lambda with the role
    const postConfirmationFn = new lambda.Function(this, 'PostConfirmationLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/postConfirmation/'),
      timeout: cdk.Duration.seconds(30),
      role: postConfirmationLambdaRole,
      environment: {
        DEFAULT_GROUP_NAME: Default_Group,
        AMAZON_GROUP_NAME: Amazon_Group,
        ADMIN_GROUP_NAME: Admin_Group,
      },
    });

    // ------------------- Cognito: User Pool, Domain, Client -------------------
    const userPool = new cognito.UserPool(this, 'PDF-Accessability-User-Pool', {
      userPoolName: 'PDF-Accessability-User-Pool',
      selfSignUpEnabled: true,
      signInAliases: { email: true },

      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false,
        requireUppercase: false,
      },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },

      },
      customAttributes: {
        first_sign_in: new cognito.BooleanAttribute({ mutable: true }),
        total_files_uploaded: new cognito.NumberAttribute({ mutable: true }),
        max_files_allowed: new cognito.NumberAttribute({ mutable: true }),
        max_pages_allowed: new cognito.NumberAttribute({ mutable: true }),
        max_size_allowed_MB: new cognito.NumberAttribute({ mutable: true }),
        organization: new cognito.StringAttribute({ mutable: true }),
        country: new cognito.StringAttribute({ mutable: true }),
        state: new cognito.StringAttribute({ mutable: true }),
        city: new cognito.StringAttribute({ mutable: true }),
        pdf2pdf: new cognito.NumberAttribute({ mutable: true }),
        pdf2html: new cognito.NumberAttribute({ mutable: true }),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      lambdaTriggers: {
        postConfirmation: postConfirmationFn,
      },
    });
    
    // ------------------- Cognito: User Groups -------------------
      const defaultUsersGroup = new cognito.CfnUserPoolGroup(this, 'Default_Group', {
        groupName: Default_Group,
        userPoolId: userPool.userPoolId,
        description: 'Group for default or normal users',
        precedence: 1, // Determines the priority of the group
      });

      // Amazon Users Group
      const amazonUsersGroup = new cognito.CfnUserPoolGroup(this, 'AmazonUsersGroup', {
        groupName: Amazon_Group,
        userPoolId: userPool.userPoolId,
        description: 'Group for Amazon Employees',
        precedence: 2,
      });

      // Admin Users Group
      const adminUsersGroup = new cognito.CfnUserPoolGroup(this, 'AdminUsersGroup', {
        groupName: Admin_Group,
        userPoolId: userPool.userPoolId,
        description: 'Group for admin users with elevated permissions',
        precedence: 0, // Higher precedence means higher priority
      });

    // Domain prefix is defined above with appUrl
    const userPoolDomain = new cognito.CfnUserPoolDomain(this, 'PDF-Accessability-User-Pool-Domain', {
      domain: domainPrefix,
      userPoolId: userPool.userPoolId,
      // Note: managedLoginVersion is only for custom domains, not Cognito prefix domains
    });

    const userPoolClient = userPool.addClient('PDF-Accessability-User-Pool-Client', {
      userPoolClientName: 'PDF-Accessability-User-Pool-Client',
      authFlows: {
        userSrp: true,
        userPassword: true,
        adminUserPassword: true
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PHONE,
          cognito.OAuthScope.PROFILE
        ],
        callbackUrls: [`${appUrl}/callback`,"http://localhost:3000/callback"],
        logoutUrls: [`${appUrl}/home`, "http://localhost:3000/home"],
      },
      generateSecret: false,
      preventUserExistenceErrors: true,
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ]
    });



    // Note: CfnManagedLoginBranding requires managedLoginVersion:2 on the UserPoolDomain,
    // which is only valid for custom domains. Since we're using a Cognito prefix domain,
    // we cannot use CfnManagedLoginBranding.
    // If you need managed login branding, you must:
    // 1. Use a custom domain with a valid SSL certificate
    // 2. Set managedLoginVersion: 2 on the UserPoolDomain
    // 3. Then add the CfnManagedLoginBranding resource

    // ------------- Identity Pool + IAM Roles for S3 Access --------------------
    const identityPool = new cognito.CfnIdentityPool(this, 'PDFIdentityPool', {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: userPoolClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });

    const authenticatedRole = new iam.Role(this, 'CognitoDefaultAuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
          'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
    });

    // Create S3 policy for both buckets
    const s3Resources: string[] = [];
    if (pdfBucket) {
      s3Resources.push(pdfBucket.bucketArn + '/*');
    }
    if (htmlBucket) {
      s3Resources.push(htmlBucket.bucketArn + '/*');
    }

    authenticatedRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:PutObject',
          's3:PutObjectAcl',
          's3:GetObject',
        ],
        resources: s3Resources,
      }),
    );

    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });



    // ------------------- Lambda Function for Post Confirmation -------------------
    const updateAttributesFn = new lambda.Function(this, 'UpdateAttributesFn', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/updateAttributes/'),
      timeout: cdk.Duration.seconds(30),
      role: postConfirmationLambdaRole,
      environment: {
        USER_POOL_ID: userPool.userPoolId, // used in index.py
      },
    });

    const checkUploadQuotaLambdaRole = new iam.Role(this, 'CheckUploadQuotaLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    // 2) Attach necessary policies
    checkUploadQuotaLambdaRole.addToPolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: [
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminUpdateUserAttributes',
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents'
      ],
    }));

    // 3) Create the Lambda function
    const checkOrIncrementQuotaFn = new lambda.Function(this, 'checkOrIncrementQuotaFn', {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset('lambda/checkOrIncrementQuota'),  
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      role: checkUploadQuotaLambdaRole,
      environment: {
        USER_POOL_ID: userPool.userPoolId  
      }
    });

    const updateAttributesApi = new apigateway.RestApi(this, 'UpdateAttributesApi', {
      restApiName: 'UpdateAttributesApi',
      description: 'API to update Cognito user attributes (org, first_sign_in,country, state, city, total_file_uploaded).',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },

    });

    // 3) Create a Cognito Authorizer (User Pool Authorizer) referencing our user pool
    const userPoolAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'UserPoolAuthorizer', {
      cognitoUserPools: [userPool], // array of user pools
    });

    // 4) Add Resource & Method
    const UpdateFirstSignIn = updateAttributesApi.root.addResource('update-first-sign-in');
    const quotaResource = updateAttributesApi.root.addResource('upload-quota');
    // We attach the Cognito authorizer and set the authorizationType to COGNITO
    UpdateFirstSignIn.addMethod('POST', new apigateway.LambdaIntegration(updateAttributesFn), {
      authorizer: userPoolAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    quotaResource.addMethod('POST', new apigateway.LambdaIntegration(checkOrIncrementQuotaFn), {
      authorizer: userPoolAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });


    // const hostedUiDomain = `https://pdf-ui-auth.auth.${this.region}.amazoncognito.com/login/continue?client_id=${userPoolClient.userPoolClientId}&redirect_uri=https%3A%2F%2Fmain.${amplifyApp.appId}.amplifyapp.com&response_type=code&scope=email+openid+phone+profile`
    const Authority = `cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;

    // ------------------ Pass environment variables to Amplify ------------------
    mainBranch.addEnvironment('REACT_APP_BUCKET_NAME', mainBucket.bucketName);
    mainBranch.addEnvironment('REACT_APP_BUCKET_REGION', this.region);
    mainBranch.addEnvironment('REACT_APP_AWS_REGION', this.region);

    // Separate buckets for different formats - use provided buckets independently
    if (PDF_TO_PDF_BUCKET) {
      mainBranch.addEnvironment('REACT_APP_PDF_BUCKET_NAME', PDF_TO_PDF_BUCKET);
    }
    if (PDF_TO_HTML_BUCKET) {
      mainBranch.addEnvironment('REACT_APP_HTML_BUCKET_NAME', PDF_TO_HTML_BUCKET);
    }
    
    mainBranch.addEnvironment('REACT_APP_USER_POOL_ID', userPool.userPoolId);
    mainBranch.addEnvironment('REACT_APP_AUTHORITY', Authority);

    mainBranch.addEnvironment('REACT_APP_USER_POOL_CLIENT_ID', userPoolClient.userPoolClientId);
    mainBranch.addEnvironment('REACT_APP_IDENTITY_POOL_ID', identityPool.ref);
    mainBranch.addEnvironment('REACT_APP_HOSTED_UI_URL', appUrl);
    mainBranch.addEnvironment('REACT_APP_DOMAIN_PREFIX', domainPrefix);

    mainBranch.addEnvironment('REACT_APP_UPDATE_FIRST_SIGN_IN', updateAttributesApi.urlForPath('/update-first-sign-in'));
    mainBranch.addEnvironment('REACT_APP_UPLOAD_QUOTA_API', updateAttributesApi.urlForPath('/upload-quota'));


     // ------------------- Integration of UpdateAttributesGroups Lambda -------------------
    // 1. Create IAM Role
    const updateAttributesGroupsLambdaRole = new iam.Role(this, 'UpdateAttributesGroupsLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for UpdateAttributesGroups Lambda function',
    });

    updateAttributesGroupsLambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cognito-idp:ListUsersInGroup',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminListGroupsForUser',
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        //cloudwatch logs
      
      ],
      resources: [
        userPool.userPoolArn,
        `${userPool.userPoolArn}/*` // Allows access to all resources within the User Pool
      ],
    }));

    // 2. Create the Lambda function
    const updateAttributesGroupsFn = new lambda.Function(this, 'UpdateAttributesGroupsFn', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/UpdateAttributesGroups/'), // Ensure this path is correct
      timeout: cdk.Duration.seconds(900),
      role: updateAttributesGroupsLambdaRole,
    });


    const cognitoTrail = new cloudtrail.Trail(this, 'CognitoTrail', {
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
    });
    
    // Remove the incorrect event selector
    // No need to add specific data resource for Cognito events
    
    const cognitoGroupChangeRule = new events.Rule(this, 'CognitoGroupChangeRule', {
      eventPattern: {
        source: ['aws.cognito-idp'],
        detailType: ['AWS API Call via CloudTrail'],
        detail: {
          eventName: ['AdminAddUserToGroup', 'AdminRemoveUserFromGroup'],
          requestParameters: {
            userPoolId: [userPool.userPoolId],
          },
        },
      },
    });
    
    cognitoGroupChangeRule.addTarget(new targets.LambdaFunction(updateAttributesGroupsFn));

    updateAttributesGroupsFn.addPermission('AllowEventBridgeInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: cognitoGroupChangeRule.ruleArn,
    });

    // ------------------- Job Management Lambda Functions -------------------

    // IAM Role for Job Management Lambdas
    const jobManagementLambdaRole = new iam.Role(this, 'JobManagementLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for Job Management Lambda functions',
    });

    jobManagementLambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [
        jobsTable.tableArn,
        `${jobsTable.tableArn}/index/*`
      ],
    }));

    // Grant S3 read access for analyze PDF Lambda
    if (pdfBucket) {
      jobManagementLambdaRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject'],
        resources: [`${pdfBucket.bucketArn}/*`],
      }));
    }

    // Analyze PDF Lambda
    const analyzePDFLambda = new lambda.Function(this, 'AnalyzePDFLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/analyzePDF/'),
      timeout: cdk.Duration.seconds(60),
      role: jobManagementLambdaRole,
      environment: {
        JOBS_TABLE_NAME: jobsTable.tableName,
        PDF_BUCKET_NAME: pdfBucket ? pdfBucket.bucketName : '',
      },
    });

    // Start Processing Lambda
    const startProcessingLambda = new lambda.Function(this, 'StartProcessingLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/startProcessing/'),
      timeout: cdk.Duration.seconds(30),
      role: jobManagementLambdaRole,
      environment: {
        JOBS_TABLE_NAME: jobsTable.tableName,
      },
    });

    // Get User Jobs Lambda
    const getUserJobsLambda = new lambda.Function(this, 'GetUserJobsLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/getUserJobs/'),
      timeout: cdk.Duration.seconds(30),
      role: jobManagementLambdaRole,
      environment: {
        JOBS_TABLE_NAME: jobsTable.tableName,
      },
    });

    // Get Job Lambda
    const getJobLambda = new lambda.Function(this, 'GetJobLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/getJob/'),
      timeout: cdk.Duration.seconds(30),
      role: jobManagementLambdaRole,
      environment: {
        JOBS_TABLE_NAME: jobsTable.tableName,
      },
    });

    // Create Job Lambda (for S3 event trigger)
    const createJobLambda = new lambda.Function(this, 'CreateJobLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/createJob/'),
      timeout: cdk.Duration.seconds(30),
      role: jobManagementLambdaRole,
      environment: {
        JOBS_TABLE_NAME: jobsTable.tableName,
        PDF_BUCKET_NAME: pdfBucket ? pdfBucket.bucketName : '',
      },
    });

    // Cancel Job Lambda
    const cancelJobLambda = new lambda.Function(this, 'CancelJobLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/cancelJob/'),
      timeout: cdk.Duration.seconds(30),
      role: jobManagementLambdaRole,
      environment: {
        JOBS_TABLE_NAME: jobsTable.tableName,
      },
    });

    // Note: S3 event trigger would be added here if needed
    // Since we're using imported buckets, we'll need to manually configure
    // the S3 event trigger or call this Lambda from the frontend after upload

    // ------------------- Jobs API Gateway -------------------
    const jobsApi = new apigateway.RestApi(this, 'JobsApi', {
      restApiName: 'PDF Jobs API',
      description: 'API for managing PDF accessibility jobs',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // Use the existing Cognito authorizer from updateAttributesApi
    const jobsAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'JobsAuthorizer', {
      cognitoUserPools: [userPool],
    });

    // Create /jobs resource
    const jobsResource = jobsApi.root.addResource('jobs');

    // POST /jobs/analyze
    const analyzeResource = jobsResource.addResource('analyze');
    analyzeResource.addMethod('POST', new apigateway.LambdaIntegration(analyzePDFLambda), {
      authorizer: jobsAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /jobs/start-processing
    const startProcessingResource = jobsResource.addResource('start-processing');
    startProcessingResource.addMethod('POST', new apigateway.LambdaIntegration(startProcessingLambda), {
      authorizer: jobsAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /jobs/my-jobs
    const myJobsResource = jobsResource.addResource('my-jobs');
    myJobsResource.addMethod('GET', new apigateway.LambdaIntegration(getUserJobsLambda), {
      authorizer: jobsAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /jobs/{job_id}
    const jobIdResource = jobsResource.addResource('{job_id}');
    jobIdResource.addMethod('GET', new apigateway.LambdaIntegration(getJobLambda), {
      authorizer: jobsAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /jobs (create job)
    jobsResource.addMethod('POST', new apigateway.LambdaIntegration(createJobLambda), {
      authorizer: jobsAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /jobs/cancel
    const cancelResource = jobsResource.addResource('cancel');
    cancelResource.addMethod('POST', new apigateway.LambdaIntegration(cancelJobLambda), {
      authorizer: jobsAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // --------------------------- Outputs ------------------------------
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'UserPoolDomain', { value: domainPrefix });
    new cdk.CfnOutput(this, 'IdentityPoolId', { value: identityPool.ref });
    new cdk.CfnOutput(this, 'AuthenticatedRole', { value: authenticatedRole.roleArn });
    new cdk.CfnOutput(this, 'AmplifyAppId', {
      value: amplifyApp.appId,
      description: 'Amplify Application ID',
    });

    new cdk.CfnOutput(this, 'AmplifyAppURL', {
      value: appUrl,
      description: 'Amplify Application URL',
    });
    new cdk.CfnOutput(this, 'UpdateFirstSignInEndpoint', {
      value: updateAttributesApi.urlForPath('/update-first-sign-in'),
      description: 'POST requests to this URL to update attributes.',
    });

    new cdk.CfnOutput(this, 'CheckUploadQuotaEndpoint', {
      value: updateAttributesApi.urlForPath('/upload-quota'),
    });

    new cdk.CfnOutput(this, 'JobsTableName', {
      value: jobsTable.tableName,
      description: 'DynamoDB table for job tracking',
    });

    new cdk.CfnOutput(this, 'AnalyzeJobEndpoint', {
      value: jobsApi.urlForPath('/jobs/analyze'),
      description: 'Endpoint to analyze PDF jobs',
    });

    new cdk.CfnOutput(this, 'StartProcessingEndpoint', {
      value: jobsApi.urlForPath('/jobs/start-processing'),
      description: 'Endpoint to start processing jobs',
    });

    new cdk.CfnOutput(this, 'GetUserJobsEndpoint', {
      value: jobsApi.urlForPath('/jobs/my-jobs'),
      description: 'Endpoint to get user jobs',
    });

    new cdk.CfnOutput(this, 'GetJobEndpoint', {
      value: jobsApi.urlForPath('/jobs'),
      description: 'Base endpoint to get job by ID (append /{job_id})',
    });

    new cdk.CfnOutput(this, 'CreateJobEndpoint', {
      value: jobsApi.urlForPath('/jobs'),
      description: 'Endpoint to create a new job (POST)',
    });

    new cdk.CfnOutput(this, 'CancelJobEndpoint', {
      value: jobsApi.urlForPath('/jobs/cancel'),
      description: 'Endpoint to cancel a job (POST)',
    });


  }
}
