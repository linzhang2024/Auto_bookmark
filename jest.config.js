/**
 * Jest 配置文件
 */

module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/*.test.js',
    '**/tests/**/*.test.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/'
  ],
  verbose: true,
  collectCoverage: false,
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  testTimeout: 30000,
  setupFiles: [
    '<rootDir>/jest.setup.js'
  ]
};
