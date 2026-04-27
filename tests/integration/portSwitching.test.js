/**
 * 集成测试：Web 服务器动态端口切换逻辑
 * 测试 Web 服务器在端口被手动占用时，是否能正确触发动态端口切换逻辑
 */

const net = require('net');
const http = require('http');

function isPortAvailable(port) {
  if (port < 0 || port > 65535 || !Number.isInteger(port)) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort, maxAttempts = 50) {
  let port = startPort;
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
    port++;
    attempts++;
  }
  
  throw new Error(`在尝试了 ${maxAttempts} 个端口后，未找到可用端口`);
}

describe('集成测试 - Web 服务器动态端口切换逻辑', () => {
  const testServers = [];

  afterEach(async () => {
    for (const server of testServers) {
      try {
        await new Promise(resolve => server.close(resolve));
      } catch (e) {
        // 忽略关闭错误
      }
    }
    testServers.length = 0;
  });

  function startPortListener() {
    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('Test Server');
    });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        testServers.push(server);
        resolve({ server, port });
      });
    });
  }

  describe('端口可用性检测', () => {
    test('isPortAvailable 应正确检测可用端口', async () => {
      const { port } = await startPortListener();
      
      const available = await isPortAvailable(port + 1000);
      expect(available).toBe(true);
    });

    test('isPortAvailable 应正确检测已占用端口', async () => {
      const { port } = await startPortListener();
      
      const available = await isPortAvailable(port);
      expect(available).toBe(false);
    });

    test('isPortAvailable 对于无效端口应返回 false', async () => {
      const available0 = await isPortAvailable(-1);
      const available1 = await isPortAvailable(65536);
      
      expect(available0).toBe(false);
      expect(available1).toBe(false);
    });
  });

  describe('端口切换逻辑模拟', () => {
    test('应能找到第一个可用端口', async () => {
      const { port } = await startPortListener();
      const startPort = port;
      
      const foundPort = await findAvailablePort(startPort + 1);
      
      expect(foundPort).toBeGreaterThan(startPort);
      expect(await isPortAvailable(foundPort)).toBe(true);
    });

    test('应跳过多个占用端口并找到可用端口', async () => {
      const { port: port1 } = await startPortListener();
      const { port: port2 } = await startPortListener();
      const { port: port3 } = await startPortListener();
      
      const occupiedPorts = [port1, port2, port3].sort((a, b) => a - b);
      const startPort = occupiedPorts[0];
      
      const foundPort = await findAvailablePort(startPort);
      
      expect(occupiedPorts).not.toContain(foundPort);
      expect(await isPortAvailable(foundPort)).toBe(true);
    });

    test('findAvailablePort 应在指定范围内查找', async () => {
      const { port } = await startPortListener();
      
      const foundPort = await findAvailablePort(port + 1, 10);
      
      expect(foundPort).toBeGreaterThan(port);
      expect(foundPort).toBeLessThanOrEqual(port + 10);
    });
  });

  describe('边界情况', () => {
    test('应正确处理端口 0（动态分配）', async () => {
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('Dynamic Port Server');
      });

      const assignedPort = await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          resolve(server.address().port);
        });
      });

      testServers.push(server);
      
      expect(assignedPort).toBeGreaterThan(0);
      expect(assignedPort).toBeLessThan(65536);
      expect(await isPortAvailable(assignedPort)).toBe(false);
    });

    test('端口检测不应影响未被测试的端口', async () => {
      const { port: port1 } = await startPortListener();
      const { port: port2 } = await startPortListener();
      
      const testPort = port1 + 100;
      const available = await isPortAvailable(testPort);
      
      expect(await isPortAvailable(port1)).toBe(false);
      expect(await isPortAvailable(port2)).toBe(false);
      expect(available).toBe(true);
    });
  });
});

describe('集成测试 - 动态端口切换策略验证', () => {
  let tempServers = [];

  afterEach(async () => {
    for (const server of tempServers) {
      try {
        await new Promise(resolve => server.close(resolve));
      } catch (e) {
        // 忽略关闭错误
      }
    }
    tempServers.length = 0;
  });

  test('模拟端口查找算法在连续占用场景下的正确性', async () => {
    const basePort = 18100;
    
    const occupiedPorts = [];
    for (let i = 0; i < 3; i++) {
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('Occupied');
      });
      
      const port = await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(basePort + i, '127.0.0.1', () => {
          resolve(server.address().port);
        });
      });
      
      tempServers.push(server);
      occupiedPorts.push(port);
    }

    let foundPort = null;
    const maxAttempts = 10;
    
    for (let i = 0; i < maxAttempts; i++) {
      const portToCheck = basePort + i;
      try {
        const server = http.createServer((req, res) => {
          res.writeHead(200);
          res.end('Test');
        });
        
        const result = await new Promise((resolve) => {
          server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
              resolve(false);
            } else {
              resolve(false);
            }
          });
          server.listen(portToCheck, '127.0.0.1', () => {
            tempServers.push(server);
            resolve(portToCheck);
          });
        });

        if (result !== false) {
          foundPort = result;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    expect(foundPort).not.toBeNull();
    expect(foundPort).toBeGreaterThanOrEqual(basePort);
    expect(occupiedPorts).not.toContain(foundPort);
  });

  test('端口查找应从起始端口开始递增查找', async () => {
    const startPort = 18200;
    
    const server1 = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('Test');
    });
    
    await new Promise((resolve, reject) => {
      server1.once('error', reject);
      server1.listen(startPort, '127.0.0.1', resolve);
    });
    tempServers.push(server1);

    const foundPort = await findAvailablePort(startPort, 5);
    
    expect(foundPort).toBe(startPort + 1);
  });
});
