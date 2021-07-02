const { TendermintTx } = require('./tendermint');
const fileHandler = require('./fileHandler');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const axios = require('axios');
const { default: fetch } = require('node-fetch');

async function findTxAddNodeToken(nodeId) {

    let fromHeight;

    const latestBlockHeightFileName = `${nodeId}-latest-block-height`
    const latestBlockHeightFilePath = path.join(__dirname, '..', 'data', latestBlockHeightFileName);

    let toHeight = parseInt(await getCurrentHeight());

    try {
        fromHeight = parseInt(fs.readFileSync(latestBlockHeightFilePath)) + 1;

    } catch (err) {
        console.log(`Cannot read latest block height from ${latestBlockHeightFileName}, using current height`);
        fromHeight = toHeight;
        await fileHandler.writeFile(latestBlockHeightFilePath, toHeight.toString());

    }

    if (fromHeight >= toHeight) {
        console.log('No blocks to proceed');
        return 0;
    }

    const blocks = Array.from(
        { length: toHeight - fromHeight + 1 },
        (v, i) => i + fromHeight
    );

    try {
        let foundTxs = blocks.map(async block => {
            const txs = await getTxsFromBlock(block);
            if (txs != null) {
                let blockHeight, txIndex;
                const foundTx = await txs.find((tx, index) => {
                    const txProtoBuffer = Buffer.from(tx, 'base64');
                    const txObject = TendermintTx.decode(txProtoBuffer);
                    if (txObject.method === 'AddNodeToken') {
                        const params = JSON.parse(txObject.params);
                        if (nodeId === params.node_id) {
                            blockHeight = block;
                            txIndex = index;
                            return tx;
                        }
                    }
                });
                if (blockHeight != null && txIndex != null) {
                    const txResult = await checkSuccessTx(blockHeight, txIndex);
    
                    if (txResult === true) {
                        return foundTx;
                    }
                }
            }
        });
    
        process.stdout.write(`Done processing block height ${fromHeight} to ${toHeight} (${toHeight - fromHeight + 1} blocks)`);
    
        await fileHandler.writeFile(latestBlockHeightFilePath, toHeight.toString());
    
        foundTxs = await Promise.all(foundTxs);
        foundTxs = foundTxs.filter(tx => typeof tx !== 'undefined');
    
        let totalTokenAdded = await getTotalTokenAdded(foundTxs);

        console.log(` => ${foundTxs.length} "AddNodeToken" Tx was found ${foundTxs.length > 0 ? 'with total amount of '+totalTokenAdded+' tokens' : ''}`);
    
        return totalTokenAdded;

    } catch (err) {
        throw err;
    }

}

async function checkSuccessTx(block, index) {

    return new Promise(async resolve => {

        try {

            const successBase64 = Buffer.from('success').toString('base64');
            const trueBase64 = Buffer.from('true').toString('base64');

            const response = await fetch(`http://${config.TM_RPC_IP}:${config.TM_RPC_PORT}/block_results?height=${block}`);
            const responseJson = await response.json();

            const txResult = responseJson.result.txs_results[index];

            const successAttribute = txResult.events
                .find((event) => event.type === 'did.result')
                .attributes.find((attribute) => attribute.key === successBase64);

            if (successAttribute) {

                if (successAttribute.value === trueBase64) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            }
            resolve(false);

        } catch (err) {
            console.log(err);
        }
    });
}


async function getTxsFromBlock(height) {

    const url = `http://${config.TM_RPC_IP}:${config.TM_RPC_PORT}/block?height=${height}`;
    const response = await axios.get(url);
    const responseJson = await response.data;

    return responseJson.result.block.data.txs;

}

async function getTotalTokenAdded(txs) {

    let totalTokenAdded = 0;

    txs.forEach(tx => {
        const txProtoBuffer = Buffer.from(tx, 'base64');
        const txObject = TendermintTx.decode(txProtoBuffer);
        const params = JSON.parse(txObject.params);
        totalTokenAdded = totalTokenAdded + params.amount;
    });

    return totalTokenAdded;
}

async function getCurrentHeight() {

    const url = `http://${config.TM_RPC_IP}:${config.TM_RPC_PORT}/block`;
    const response = await axios.get(url);
    const responseJson = await response.data;

    return responseJson.result.block.header.height;
}

module.exports = {
    findTxAddNodeToken,
    getCurrentHeight
}