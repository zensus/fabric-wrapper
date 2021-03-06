const path = require('path');
const FabricClient = require('fabric-client');
const Orderer = require('fabric-client/lib/Orderer.js');
const Peer = require('fabric-client/lib/Peer.js');
const User = require('fabric-client/lib/User.js');
const CaService = require('fabric-ca-client/lib/FabricCAClientImpl.js');
const jsrsa = require('jsrsasign');
const KEYUTIL = jsrsa.KEYUTIL;
const EcdsaKey = require('fabric-client/lib/impl/ecdsa/key');
const CryptoSuite = require('fabric-client/lib/impl/CryptoSuite_ECDSA_AES');
const KeyStore = require('fabric-client/lib/impl/CryptoKeyStore');

const Chain = require('./Chain');
const keyStorePath = CryptoSuite.getDefaultKeyStorePath();

async function getSubmitter(client, options) {
  const { enrollmentID } = options.enrollment;
  const user = await client.getUserContext(enrollmentID);

  if (user && user.isEnrolled()) {
    return user;
  } else {
    let enrollment;

    if (options.caUrl && options.enrollment.enrollmentSecret) {
      const caClient = new CaService(options.caUrl);
      enrollment = await caClient.enroll(options.enrollment);
    } else {
      enrollment = options.enrollment;
      enrollment.key = new EcdsaKey(KEYUTIL.getKey(enrollment.key));

      const keyStore = await new KeyStore({ path: keyStorePath });
      await keyStore.putKey(enrollment.key);
    }

    const member = new User(enrollmentID, client);
    await member.setEnrollment(enrollment.key, enrollment.cert || enrollment.certificate, options.mspId);
    client.setUserContext(member);

    return member;
  }
}

module.exports = async function (options) {
  if (!options.uuid) {
    throw new Error('Cannot enroll with undefined uuid');
  }

  const client = new FabricClient();
  const chain = client.newChain(options.channelId);

  const store = await FabricClient.newDefaultKeyValueStore({
    path: path.join(keyStorePath, options.uuid) //store eCert in the kvs directory
  });

  client.setStateStore(store);
  const submitter = await getSubmitter(client, options);
  chain.addOrderer(new Orderer(options.ordererUrl));

  const peers = options.peerUrls.map(peerUrl => new Peer(peerUrl));
  for (const peer of peers) {
    chain.addPeer(peer);
  }
  chain.setPrimaryPeer(peers[0]);

  return new Chain({ chain, submitter }, options);
};