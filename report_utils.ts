import * as _ from "lodash";

export const generateReport = (dbStat, r) => {
    console.log(
        `${new Date().valueOf()},${process.env.INSTANCE_TYPE},${
        process.env.RAM_SIZE
        },${process.env.CPU_CORES},${process.env.STORAGE},${dbStat.size},${
        dbStat.count
        },${dbStat.avgObjSize},${r.count},${_.mean(r.stats)},${Math.round(
            r.count / _.mean(r.stats)
        )},${
        process.env.DB_AGGR_ALLOW_DISK_USE
        },${
        _.mean(r.sys.map(x => x.cpu[0]))
        },${
        _.mean(r.sys.map(x => x.cpu[1]))
        },${
        _.mean(r.sys.map(x => x.cpu[2]))
        },${
        _.mean(r.sys.map(x => x.cpu[3]))
        },${
        _.mean(r.sys.map(x => x.mem[0]))
        },${
        _.mean(r.sys.map(x => x.mem[1]))
        },${
        _.mean(r.sys.map(x => x.mem[2]))
        },${r.stats.join(",")}`
    );
};