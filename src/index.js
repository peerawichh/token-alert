const tendermint = require('./tendermint');
const config = require('./config');
const notifty = require('./notify');
const { findTxAddNodeToken, getCurrentHeight } = require('./findTx');
const fileHandler = require('./fileHandler');

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const CRON_TAB_1 = `${config.CRON_MINUTE} ${config.CRON_HOUR} ${config.CRON_DAY_OF_MONTH} ${config.CRON_MONTH} ${config.CRON_DAY_OF_WEEK}`;
const CRON_TAB_2 = `3 ${config.CRON_MINUTE} ${config.CRON_HOUR} ${config.CRON_DAY_OF_MONTH} ${config.CRON_MONTH} ${config.CRON_DAY_OF_WEEK}`;

cron.schedule(CRON_TAB_1, checkNodeToken);
cron.schedule(CRON_TAB_2, checkUnconditionalNodeToken);
cron.schedule(`${config.CRON_MINUTE_READ_BLOCKS} * * * *`, readBlockIntervals);

initFiles();

async function checkNodeToken() {

    console.log(`\n\n\n\n\nCron Job started at ${Date()}`);

    try {
        let node_id_list = await getNodeIDByRole('');
        let queriedNodeIDList = await queryNodeByTokenAmount(node_id_list);

        if (queriedNodeIDList.length === 0) {
            console.log(`\n\nNo nodes with token amount below the threshold (${config.TOKEN_THRESHOLD_TO_ALERT.toLocaleString}) were detected\n`)
            await notifty.lineNotify(`No nodes with token amount below the threshold (${config.TOKEN_THRESHOLD_TO_ALERT.toLocaleString}) were detected`);
            return;
        }

        const nodeListGroupedByMarketingName = await groupNodesByMarketingName(queriedNodeIDList);
        const Orgs = Object.keys(nodeListGroupedByMarketingName);

        Orgs.forEach(Org => {
            let nodeList = nodeListGroupedByMarketingName[Org];
            let message = `${Org}`;
            nodeList.forEach(node => {
                message = message.concat(`\n\n${node.node_id} (${node.role}): ${node.token.toLocaleString()} ${node.token > 1 ? 'tokens' : 'token'} left`);
            });
            console.log(`\nNotifying low token amount of ${Org}: ${nodeList.length} ${nodeList.length > 1 ? 'nodes' : 'node'} in total\n`);
            notifty.lineNotify(message);
        });

    } catch (err) {
        console.log(err);
    }
}

async function checkUnconditionalNodeToken() {

    try {

        let node_id_list = config.UNCONDITIONAL_NODE_LIST.split(',');
        node_id_list = node_id_list.map(async (node) => {

            const { queryResult, blockHeight } = await tendermint.query('GetNodeToken', { node_id: node });
            const node_info = await getNodeInfo(node);

            return {
                node_id: node,
                token: queryResult.amount,
                node_name: node_info.marketing_name_en,
                role: node_info.role
            }

        });

        node_id_list = await Promise.all(node_id_list);
        node_id_list = node_id_list.filter(node => typeof node !== 'undefined');

        node_id_list.forEach(async node => {

            let message = `${node.node_name}\n\nNode ID: ${node.node_id}\n\nRole: ${node.role === 'IDP' ? 'IdP' : node.role}\n\nCurrent token amount: ${node.token.toLocaleString()}`;

            const latestTokenAmountFileName = `${node.node_id}-latest-token-amount`
            const latestTokenAmountFilePath = path.join(__dirname, '..', 'data', latestTokenAmountFileName);
            const latestTokenAddedFileName = `${node.node_id}-total-token-added`
            const latestTokenAddedFilePath = path.join(__dirname, '..', 'data', latestTokenAddedFileName);

            if (new Date().getHours() == config.CRON_HOUR.split(',')[1]) {

                let latestTokenAmount, latestTokenAdded;

                try {
                    latestTokenAmount = parseInt(fs.readFileSync(latestTokenAmountFilePath));
                    latestTokenAdded = parseInt(fs.readFileSync(latestTokenAddedFilePath));

                } catch (err) {
                    console.log(`File not found`);
                }

                let foundTokenAdded = await findTxAddNodeToken(node.node_id);
                let totalTokenAdded = latestTokenAdded + foundTokenAdded;

                if (latestTokenAmount !== 0) {

                    let totalTokenUsed = (latestTokenAmount - parseInt(node.token)) + totalTokenAdded;

                    message = message.concat(`\n\n${totalTokenUsed.toLocaleString()} total tokens used over the past 24 hours`);
                    console.log(`total token used = ${totalTokenUsed} (${latestTokenAmount} - ${node.token}) + ${totalTokenAdded}`);

                }

                if (totalTokenAdded > 0) {
                    message = message.concat(`\n\n${totalTokenAdded.toLocaleString()} tokens added during the past 24 hours`);
                }

            }

            await notifty.lineNotify(message);

            await Promise.all(
                [
                    fileHandler.writeFile(latestTokenAddedFilePath, '0'),
                    fileHandler.writeFile(latestTokenAmountFilePath, (node.token).toString())
                ]
            );

        });

    } catch (err) {
        console.log(err);
    }
}

async function readBlockIntervals() {

    let node_id_list = config.UNCONDITIONAL_NODE_LIST.split(',');

    node_id_list.forEach(async node_id => {

        const latestTokenAddedFileName = `${node_id}-total-token-added`
        const latestTokenAddedFilePath = path.join(__dirname, '..', 'data', latestTokenAddedFileName);
        let latestTokenAdded;

        try {
            latestTokenAdded = parseInt(fs.readFileSync(latestTokenAddedFilePath));
        } catch (err) {
            console.log(`Cannot read file ${latestTokenAddedFileName}`);
        }

        if (latestTokenAdded == null) {
            latestTokenAdded = 0;
        }

        let foundTokenAdded = await findTxAddNodeToken(node_id);

        if (foundTokenAdded > 0) {

            if (latestTokenAdded > 0) {
                foundTokenAdded = foundTokenAdded + latestTokenAdded;
            }

            await fileHandler.writeFile(latestTokenAddedFilePath, foundTokenAdded.toString());

        }
    });
}

async function groupNodesByMarketingName(node_id_list) {
    const grouped = node_id_list.reduce((result, node) => {
        const marketingName = (result[node.node_name] || []);
        marketingName.push(node);
        result[node.node_name] = marketingName;
        return result;
    }, {});
    return grouped;
}

async function queryNodeByTokenAmount(node_id_list) {

    try {

        let queriedNode = node_id_list.map(async (node) => {

            if (config.UNCONDITIONAL_NODE_LIST.split(',').includes(node)) {
                return undefined;
            }

            const { queryResult } = await tendermint.query('GetNodeToken', { node_id: node });
            const node_info = await getNodeInfo(node);

            if (queryResult.amount < config.TOKEN_THRESHOLD_TO_ALERT) {
                return {
                    node_id: node,
                    token: queryResult.amount,
                    node_name: node_info.marketing_name_en,
                    role: node_info.role
                }
            }
        });
        queriedNode = await Promise.all(queriedNode);
        queriedNode = queriedNode.filter(node => typeof node !== 'undefined');

        return queriedNode;

    } catch (err) {
        throw err;
    }
}

async function getNodeIDByRole(role) {
    try {
        const { queryResult } = await tendermint.query('GetNodeIDList', { role: role });
        return queryResult.node_id_list;
    } catch (err) {
        throw err;
    }
}

async function getNodeInfo(node_id) {
    try {
        const { queryResult } = await tendermint.query('GetNodeInfo', { node_id: node_id });
        return JSON.parse(queryResult.node_name);
    } catch (err) {
        throw err;
    }
}

function initFiles() {

    const node_id_list = config.UNCONDITIONAL_NODE_LIST.split(',');

    node_id_list.forEach(async node_id => {

        const latestTokenAmountFileName = `${node_id}-latest-token-amount`
        const latestTokenAmountFilePath = path.join(__dirname, '..', 'data', latestTokenAmountFileName);

        const latestTokenAddedFileName = `${node_id}-total-token-added`
        const latestTokenAddedFilePath = path.join(__dirname, '..', 'data', latestTokenAddedFileName);

        const latestBlockHeightFileName = `${node_id}-latest-block-height`
        const latestBlockHeightFilePath = path.join(__dirname, '..', 'data', latestBlockHeightFileName);

        let promises = [];

        try {

            if (!fs.existsSync(latestTokenAmountFilePath)) {
                promises.push(fileHandler.writeFile(latestTokenAmountFilePath, '0'));
            }
            if (!fs.existsSync(latestTokenAddedFilePath)) {
                promises.push(fileHandler.writeFile(latestTokenAddedFilePath, '0'));
            }
            if (!fs.existsSync(latestBlockHeightFilePath)) {
                let height = await getCurrentHeight();
                promises.push(fileHandler.writeFile(latestBlockHeightFilePath, height.toString()));
            }

        } catch (err) {
            console.log(err);
        }

        await Promise.all(promises);
        console.log(`${promises.length} ${promises > 1 ? 'files' : 'file'} initialized`);

    });
}