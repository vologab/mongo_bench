import { exec } from 'child_process';

export const execPromise = (command): Promise<string> => {
    return new Promise(function(resolve, reject) {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(stdout.trim());
        });
    });
}

export const getSysLoadData = async (intervalSeconds: number = 1, times: number = 1) => {

    const commandCpuUsage = `sar -u ${intervalSeconds} ${times} | tail -n 1 | awk '{print $3,$4,$5,$6}'`;
    const commandMemUsage = `sar -r ${intervalSeconds} ${times} | tail -n 1 | awk '{print $2,$3,$4}'`;
    
    // For testing on MAC OS
    // const commandCpuUsage = `docker run -i --rm buzztaiki/sysstat:centos5 bash -c "sar -u ${intervalSeconds} ${times} | tail -n 1 | awk '{print \\$3,\\$4,\\$5,\\$6}'"`;
    // const commandMemUsage = `docker run -i --rm buzztaiki/sysstat:centos5 bash -c "sar -r ${intervalSeconds} ${times} | tail -n 1 | awk '{print \\$2,\\$3,\\$4}'"`;
    
    // console.log(commandCpuUsage);
    // console.log(commandMemUsage);

    const cpuUsage = await execPromise(commandCpuUsage);
    const memUsage = await execPromise(commandMemUsage);    
    // console.log('cpu usage:', cpuUsage.replace(/\s+/g, ','));
    // console.log('mem usage:', memUsage.replace(/\s+/g, ','));
    return { cpu: cpuUsage.split(' ').map(v => parseFloat(v)), mem: memUsage.split(' ').map(v => parseFloat(v)) };
}


getSysLoadData();
