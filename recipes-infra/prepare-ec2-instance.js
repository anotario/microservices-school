// your role should contain
// - AmazonEC2FullAccess
// - AmazonS3FullAccess

const R = require('ramda');
const { join } = require('path');
const fs = require('fs');
const { ec2 } = require('./lib/aws');
const ec2Config = require('./config/ec2.json');
const { downloadPemFile } = require('./lib/s3');
const { runInstallation } = require('./lib/ssh');

const INSTANCE_NAME = 'recipes-ec2-instance';
const S3_BUCKET = 'microservices-school-recipes';
const PEM_KEY_PATH = join(__dirname, 'micro-school-ec2.pem');

const DELAY = 5000;

const removeFile = (filePath) => new Promise((resolve, reject) => {
  fs.unlink(filePath, (err) => (err ? reject(err) : resolve()));
});

const setup = (publicDnsName) =>
  downloadPemFile(PEM_KEY_PATH)
  .then(() => 
    wait(DELAY)
    .then(() => {
      console.log('About to run setup commands via ssh...');
      return runInstallation(publicDnsName, PEM_KEY_PATH)
      .then(() => removeFile(PEM_KEY_PATH));
    }));

const checkInstances = () => {
  console.log('Checking running instances...');
  const params = { Filters: [ { Name: 'instance-state-name', Values: [ 'running'] } ] };
  return ec2.describeInstances(params);
};

const createInstance = () => {
  console.log('Creating new EC2 instance...');
  const tags = {
    TagSpecifications: [{
      ResourceType: 'instance',
      Tags: [{
          Key: 'Name',
          Value: INSTANCE_NAME,
      }]
    }]
  };
  const instanceConfig = R.merge(ec2Config, tags);
  return ec2.runInstances(instanceConfig);
};

const extractPublicDns = (Reservations) => Reservations 
  && Reservations[0] 
  && Reservations[0].Instances
  && Reservations[0].Instances[0]
  && Reservations[0].Instances[0].PublicDnsName;

const retry = (fn, ...args) => new Promise((resolve) => {
  setTimeout(() => fn(args).then(resolve), DELAY);
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const findPublicDns = () => 
  checkInstances()
  .then(({ Reservations }) => {
    const publicDns = extractPublicDns(Reservations);
    return publicDns ? publicDns : retry(findPublicDns);
  });

checkInstances()
.then(({ Reservations }) => {
  if (Reservations.length > 0) {
    const publicDnsName = extractPublicDns(Reservations);
    console.log(`The EC2 ${publicDnsName} instance has already been configured and it is running!`);
    return setup(publicDnsName)
  }
  return createInstance()
    .then(() => 
      findPublicDns()
      .then(setup));
})
.then(() => {
  console.log('DONE!!');
  process.exit(0);
})
.catch((err) => {
  console.error(err);
  process.exit(1);
});
