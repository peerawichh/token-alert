const tendermint = require('./tendermint');
const config = require('./config');
const notifty = require('./notify');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { parse } = require('path');

const CRON_TAB_1 = `${config.CRON_MINUTE} ${config.CRON_HOUR} ${config.CRON_DAY_OF_MONTH} ${config.CRON_MONTH} ${config.CRON_DAY_OF_WEEK}`;
const CRON_TAB_2 = `3 ${config.CRON_MINUTE} ${config.CRON_HOUR} ${config.CRON_DAY_OF_MONTH} ${config.CRON_MONTH} ${config.CRON_DAY_OF_WEEK}`
cron.schedule(CRON_TAB_1, checkNodeToken);
cron.schedule(CRON_TAB_2, checkUnconditionalNodeToken);

async function checkNodeToken() {

    console.log(`\n\n\n\n\nCron Job started at ${Date()}`);

    try {
        let node_id_list = await getNodeIDByRole('');
        let queriedNodeIDList = await queryNodeByTokenAmount(node_id_list);

        if (queriedNodeIDList.length === 0) {
            console.log(`\n\nNo nodes with token amount below the threshold (${config.TOKEN_THRESHOLD_TO_ALERT}) were detected\n`)
            await notifty.lineNotify(`No nodes with token amount below the threshold (${config.TOKEN_THRESHOLD_TO_ALERT}) were detected`);
            return;
        }

        const nodeListGroupedByMarketingName = await groupNodesByMarketingName(queriedNodeIDList);
        const Orgs = Object.keys(nodeListGroupedByMarketingName);

        Orgs.forEach(Org => {
            let nodeList = nodeListGroupedByMarketingName[Org];
            let message = `${Org}`;
            nodeList.forEach(node => {
                message = message.concat(`\n\n${node.node_id} (${node.role}): ${node.token} ${node.token > 1 ? 'tokens' : 'token'} left`);
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

            const result = await tendermint.query('GetNodeToken', { node_id: node });
            const node_info = await getNodeInfo(node);

            return {
                node_id: node,
                token: result.amount,
                node_name: node_info.marketing_name_en,
                role: node_info.role
            }

        });

        node_id_list = await Promise.all(node_id_list);
        node_id_list = node_id_list.filter(node => typeof node !== 'undefined');;

        node_id_list.forEach(async (node) => {

            let message = `${node.node_name}\n\n${node.node_id} (${node.role}): ${node.token} ${node.token > 1 ? 'tokens' : 'token'} left`;

            if (new Date().getHours() == config.CRON_HOUR.split(',')[1]) {

                const fileName = `${node.node_id}-latest-token-amount`
                const filePath = path.join(__dirname, '..', 'data', fileName);
                let latestTokenAmount;

                try {
                    latestTokenAmount = fs.readFileSync(filePath);
    
                } catch (err) {
                    console.log(`\n${fileName} | File not found`);
                }

                if (latestTokenAmount != null) {
                    message = message.concat(`\n\n${parseInt(latestTokenAmount) - parseInt(node.token)} total tokens used over the previous 24 hours`)
                }
    
                fs.writeFile(filePath, node.token.toString(), (err) => {

                    if (err) {
                        console.log(err);
                    }
                    console.log(`\nNew latest token amount saved to file named ${fileName} | ${node.token}`);
                });

            }

            notifty.lineNotify(message);

        });

    } catch (err) {
        console.log(err);
    }
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

            const result = await tendermint.query('GetNodeToken', { node_id: node });
            const node_info = await getNodeInfo(node);
            // const unconditional_node_list = config.UNCONDITIONAL_NODE_LIST.split(',');
            // if (unconditional_node_list.includes(node)){
            //     return {
            //         node_id: node,
            //         token: result.amount,
            //         node_name: node_info.marketing_name_en,
            //         role: node_info.role
            //     }
            // }

            if (result.amount < config.TOKEN_THRESHOLD_TO_ALERT) {
                return {
                    node_id: node,
                    token: result.amount,
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
        const result = await tendermint.query('GetNodeIDList', { role: role });
        return result.node_id_list;
    } catch (err) {
        throw err;
    }
}

async function getNodeInfo(node_id) {
    try {
        const result = await tendermint.query('GetNodeInfo', { node_id: node_id });
        return JSON.parse(result.node_name);
    } catch (err) {
        throw err;
    }
}