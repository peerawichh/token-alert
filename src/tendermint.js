const protobuf = require('protobufjs');
const path = require('path');
const config = require('./config');
const fetch = require('node-fetch');

const tendermintProtobufRootInstance = new protobuf.Root();
const tendermintProtobufRoot = tendermintProtobufRootInstance.loadSync(
    path.join(__dirname,'.','tendermint.proto'),
    { keepCase: true }
  );
const TendermintQuery = tendermintProtobufRoot.lookupType('Query');

async function query(fnName, param){

    const queryObject = {
        method: fnName,
        params: JSON.stringify(param)
    }

    const queryProto = TendermintQuery.create(queryObject);
    const queryProtoBuffer = TendermintQuery.encode(queryProto).finish();

    const params = {
      key: 'data',
      value: `0x${queryProtoBuffer.toString('hex')}`,
    }

    const queryParams = `?${params.key}=${encodeURIComponent(params.value)}`;
    const uri = `http://${config.TM_RPC_IP}:${config.TM_RPC_PORT}/abci_query${queryParams}`;

    try {
        const result = await fetch(uri);

        if (!result.ok){
            throw new Error('Tendermint HTTP Call Error');
        }

        const resultJson = await result.json();

        if (resultJson.value === null || resultJson.error || resultJson.result === null){
            throw new Error('Tendermint Query Error');
        }

        return JSON.parse(Buffer.from(resultJson.result.response.value, 'base64'));

    } catch(err){
        throw err;
    }
}

module.exports = {
    query
}