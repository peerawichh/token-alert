const tendermint = require('./tendermint');
const config = require('./config');
const notifty = require('./notify');
const cron = require('node-cron');

// const CRON_TAB = `${config.CRON_MINUTE} ${config.CRON_HOUR} ${config.CRON_DAY_OF_MONTH} ${config.CRON_MONTH} ${config.CRON_DAY_OF_WEEK}`;
// cron.schedule(CRON_TAB, checkNodeToken);

async function checkNodeToken() {
    console.log('------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------\n')
    console.log('                                                       |--------------------------------------------------------------------------|');
    console.log(`                                                       |  Cron Job started at ${Date()}  |`);
    console.log('                                                       |--------------------------------------------------------------------------|\n');
    try {
        let node_id_list = await getNodeIDByRole('');
        let queriedNodeIDList = await queryNodeByTokenAmount(node_id_list);
        node_id_list = null;

        // if (queriedNodeIDList.length === config.UNCONDITIONAL_NODE_LIST.split(',').length){
        //     console.log(`No nodes with token amount below the threshold (${config.TOKEN_THRESHOLD_TO_ALERT}) were detected\n`)
        //     notifty.lineNotify(`No nodes with token amount below the threshold (${config.TOKEN_THRESHOLD_TO_ALERT}) were detected`);
        // }

        const nodeListGroupedByMarketingName = await groupNodesByMarketingName(queriedNodeIDList);
        const Orgs = Object.keys(nodeListGroupedByMarketingName);

        Orgs.forEach( Org => {
            let nodeList = nodeListGroupedByMarketingName[Org];
            let message = `${Org}`;
            nodeList.forEach( node => {
                message = message.concat(`\n\n${node.node_id} (${node.role}): ${node.token} ${node.token>1 ? 'tokens': 'token'} left`);
            });
            console.log(`Notifying low token amount of ${Org}: ${nodeList.length} ${nodeList.length>1 ? 'nodes' : 'node'} in total\n`);
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
            const result = await tendermint.query('GetNodeToken', { node_id: node });
            const node_info = await getNodeInfo(node);
            const unconditional_node_list = config.UNCONDITIONAL_NODE_LIST.split(',');
            if (unconditional_node_list.includes(node)){
                return {
                    node_id: node,
                    token: result.amount,
                    node_name: node_info.marketing_name_en,
                    role: node_info.role
                }
            }
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

checkNodeToken();