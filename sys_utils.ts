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

export const getSysLoadData = async () => {

    const commandCpuUsage = "top -d 5 -b -n 1 | head -n 3 | tail -n 1 | awk '{print $2,$4,$10}'";
    const commandMemUsage = "top -d 5 -b -n 1 | head -n 4 | tail -n 1 | awk '{print $4,$6,$8,$10}'";
    
    // For testing on MAC OS
    // const commandCpuUsage = `docker run --rm -t ubuntu:latest bash -c "top -n 1 | head -n 3 | tail -n 1 | awk '{print \\$2,\\$4,\\$10}'"`;
    // const commandMemUsage = `docker run --rm -t ubuntu:latest bash -c "top -n 1 | head -n 4 | tail -n 1 | awk '{print \\$4,\\$6,\\$8,\\$10}'"`;
    
    const cpuUsage = await execPromise(commandCpuUsage);
    const memUsage = await execPromise(commandMemUsage);    
    // console.log('cpu usage:', cpuUsage.replace(/\s+/g, ','));
    // console.log('mem usage:', memUsage.replace(/\s+/g, ','));
    return { cpu: cpuUsage.split(' ').map(v => parseFloat(v)), mem: memUsage.split(' ').map(v => parseFloat(v)) };
}


getSysLoadData();
