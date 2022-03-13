/*
*                      Copyright 2022 Salto Labs Ltd.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with
* the License.  You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
import { AdapterAuthentication, ObjectType } from '@salto-io/adapter-api'
import { addAdapter, installAdapter, LoginStatus, updateCredentials } from '@salto-io/core'
import { Workspace } from '@salto-io/workspace'
import { getPrivateAdaptersNames } from '../../src/formatter'
import { addAction, listAction, loginAction } from '../../src/commands/service'
import { processOauthCredentials } from '../../src/cli_oauth_authenticator'
import * as mocks from '../mocks'
import * as callbacks from '../../src/callbacks'
import { CliExitCode } from '../../src/types'

jest.mock('../../src/cli_oauth_authenticator', () => ({
  processOauthCredentials: jest.fn().mockResolvedValue({
    fields: {
      instanceUrl: 'someInstanceUrl',
      accessToken: 'accessToken',
    },
  }),
}))
jest.mock('@salto-io/core', () => ({
  ...jest.requireActual<{}>('@salto-io/core'),
  getAdaptersCredentialsTypes: jest.fn().mockImplementation((serviceNames: string[]):
        Record<string, AdapterAuthentication> => {
    if (serviceNames[0] === 'noAdapter') {
      throw new Error('no adapter')
    }
    return {
      newAdapter: mocks.mockCredentialsType('newAdapter'),
      hubspot: mocks.mockCredentialsType('hubspot'),
      '': mocks.mockCredentialsType(''),
      oauthAdapter: mocks.mockOauthCredentialsType('oauthAdapter', { url: '',
        oauthRequiredFields: [''] }),
    }
  }),
  addAdapter: jest.fn().mockImplementation((
    _workspace: Workspace,
    adapterName: string
  ): Promise<AdapterAuthentication> => {
    if (adapterName === 'noAdapter') {
      throw new Error('no adapter')
    }
    return Promise.resolve(mocks.mockAdapterAuthentication(mocks.mockConfigType(adapterName)))
  }),
  updateCredentials: jest.fn().mockResolvedValue(true),
  getLoginStatuses: jest.fn().mockImplementation((
    _workspace: Workspace,
    accountNames: string[],
  ) => {
    const loginStatuses: Record<string, LoginStatus> = {}
    accountNames.forEach(accountName => {
      if (accountName === 'salesforce') {
        loginStatuses[accountName] = {
          isLoggedIn: true,
          configTypeOptions: mocks.mockAdapterAuthentication(mocks.mockConfigType(accountName)),
        }
      } else if (accountName === 'oauthAdapter') {
        loginStatuses[accountName] = {
          isLoggedIn: true,
          configTypeOptions: mocks.mockOauthCredentialsType(accountName, { url: '',
            oauthRequiredFields: [''] }),
        }
      } else {
        loginStatuses[accountName] = {
          isLoggedIn: false,
          configTypeOptions: mocks.mockAdapterAuthentication(mocks.mockConfigType(accountName)),
        }
      }
    })
    return loginStatuses
  }),
  installAdapter: jest.fn(),
  getSupportedServiceAdapterNames: jest.fn()
    .mockReturnValue(['salesforce', 'newAdapter', 'workato', 'netsuite']),
}))

describe('service command group', () => {
  let cliArgs: mocks.MockCliArgs
  let output: mocks.MockCliOutput
  let workspace: mocks.MockWorkspace
  const mockGetCredentialsFromUser = mocks.createMockGetCredentialsFromUser({
    username: 'test@test',
    password: 'test',
    token: 'test',
    sandbox: false,
  })
  const mockGetOAuthCredentialsFromUser = mocks.createMockGetCredentialsFromUser({
    port: 8888,
    consumerKey: 'test',
  })

  beforeEach(() => {
    cliArgs = mocks.mockCliArgs()
    output = cliArgs.output
    workspace = mocks.mockWorkspace({ accounts: ['salesforce', 'hubspot', 'oauthAdapter'] })
  })
  describe('list command', () => {
    let cliCommandArgs: mocks.MockCommandArgs
    beforeEach(() => {
      cliCommandArgs = mocks.mockCliCommandArgs('list', cliArgs)
    })
    describe('when the workspace loads successfully', () => {
      describe('When Environment option not used', () => {
        beforeEach(async () => {
          await listAction({
            ...cliCommandArgs,
            input: {},
            workspace,
          })
        })
        it('should not print private services', () => {
          expect(output.stdout.content).toContain('Additional supported services are:')
          expect(!getPrivateAdaptersNames().some(privateName =>
            output.stdout.content.split('Additional supported services are:')[1].includes(privateName))).toBeTruthy()
        })
        it('should print configured services under configured services', () => {
          expect(output.stdout.content).toContain('The configured accounts are:')
          expect(output.stdout.content.split('Additional supported services are:')[0]).toContain('salesforce')
        })
        it('should print other services under additional services', () => {
          expect(output.stdout.content).toContain('Additional supported services are:')
          expect(!['workato', 'netsuite'].some(serviceName => !output.stdout.content
            .split('Additional supported services are:')[1]
            .includes(serviceName))).toBeTruthy()
        })
        it('should use current env', () => {
          expect(workspace.setCurrentEnv).not.toHaveBeenCalled()
        })
      })

      describe('When Environment option used', () => {
        it('should use provided env', async () => {
          await listAction({
            ...cliCommandArgs,
            input: {
              env: mocks.withEnvironmentParam,
            },
            workspace,
          })
          expect(workspace.setCurrentEnv).toHaveBeenCalledWith(mocks.withEnvironmentParam, false)
        })
      })
    })
  })

  describe('add command', () => {
    let cliCommandArgs: mocks.MockCommandArgs
    beforeEach(() => {
      cliCommandArgs = mocks.mockCliCommandArgs('add', cliArgs)
    })
    beforeAll((() => {
      jest.spyOn(callbacks, 'getCredentialsFromUser').mockImplementation((obj: ObjectType) =>
        Promise.resolve(mockGetCredentialsFromUser(obj)))
    }))
    describe('when the workspace loads successfully', () => {
      describe('when called with already configured account', () => {
        beforeEach(async () => {
          await addAction({
            ...cliCommandArgs,
            input: {
              serviceType: 'salesforce',
              authType: 'basic',
              login: true,
            },
            workspace,
          })
        })

        it('should print already added', () => {
          expect(output.stderr.content).toContain('salesforce was already added to this environment')
        })
      })

      describe('When called with invalid accountName', () => {
        beforeEach(async () => {
          await addAction({
            ...cliCommandArgs,
            input: {
              serviceType: 'salesforce',
              accountName: 'falsd;l;l;l',
              authType: 'basic',
              login: true,
            },
            workspace,
          })
        })
        it('should throw error', () => {
          expect(output.stderr.content).toContain('Invalid account name')
        })
      })

      describe('When called with empty accountName', () => {
        beforeEach(async () => {
          await addAction({
            ...cliCommandArgs,
            input: {
              serviceType: 'salesforce',
              accountName: '',
              authType: 'basic',
              login: true,
            },
            workspace,
          })
        })
        it('should throw error', () => {
          expect(output.stderr.content).toContain('empty string')
        })
      })

      describe('When called with var as accountName', () => {
        beforeEach(async () => {
          await addAction({
            ...cliCommandArgs,
            input: {
              serviceType: 'salesforce',
              accountName: 'var',
              authType: 'basic',
              login: true,
            },
            workspace,
          })
        })
        it('should throw error', () => {
          expect(output.stderr.content).toContain('may not be "var"')
        })
      })

      describe('when called with a new service', () => {
        describe('when called with login parameters', () => {
          it('should succeed when called with valid parameters', async () => {
            const exitCode = await addAction({
              ...cliCommandArgs,
              input: {
                serviceType: 'newAdapter',
                authType: 'basic',
                login: true,
                loginParameters: [
                  'username=testUser',
                  'password="testPass\\"w==ord"',
                  'token=testToken',
                  'sandbox=y',
                ],
              },
              workspace,
            })
            expect(exitCode).toEqual(CliExitCode.Success)
          })
          it('should fail when called with missing parameter', async () => {
            const exitCode = await addAction({
              ...cliCommandArgs,
              input: {
                serviceType: 'newAdapter',
                authType: 'basic',
                login: true,
                loginParameters: [
                  'username=testUser',
                  'password=testPassword',
                  'token=testToken',
                ],
              },
              workspace,
            })
            expect(exitCode).toEqual(CliExitCode.AppError)
          })
          it('should fail when called with malformed parameter', async () => {
            const exitCode = await addAction({
              ...cliCommandArgs,
              input: {
                serviceType: 'newAdapter',
                authType: 'basic',
                login: true,
                loginParameters: [
                  'username=testUser',
                  'password=testPassword',
                  'testToken',
                  'sandbox=y',
                ],
              },
              workspace,
            })
            expect(exitCode).toEqual(CliExitCode.AppError)
          })
        })
        describe('when called with valid credentials', () => {
          beforeEach(async () => {
            await addAction({
              ...cliCommandArgs,
              input: {
                serviceType: 'newAdapter',
                authType: 'basic',
                login: true,
              },
              workspace,
            })
          })
          it('should print login information updated', () => {
            expect(output.stdout.content).toContain('Login information successfully updated!')
          })

          it('should print added', () => {
            expect(output.stdout.content).toContain('added to the environment')
          })

          it('should print please enter credentials', () => {
            expect(output.stdout.content).toContain('Please enter your Newadapter credentials:')
          })

          it('should invoke the adapter install method', () => {
            expect(installAdapter).toHaveBeenCalled()
          })
        })

        it('should throw an error if the adapter failed to install', async () => {
          const installAdapterMock = installAdapter as jest.Mock
          installAdapterMock.mockRejectedValueOnce(new Error('Failed to install Adapter!'))
          await expect(
            addAction({
              ...cliCommandArgs,
              input: {
                serviceType: 'newAdapter',
                authType: 'basic',
                login: true,
              },
              workspace,
            })
          ).rejects.toThrow()
        })

        describe('when add called with unsupported auth type', () => {
          beforeEach(async () => {
            await addAction({
              ...cliCommandArgs,
              input: {
                serviceType: 'newAdapter',
                authType: 'oauth',
                login: true,
              },
              workspace,
            })
          })

          it('fails with no such auth type error', () => {
            expect(output.stderr.content).toContain('Error: Could not login to newAdapter: Adapter does not support authentication of type oauth')
          })
        })

        describe('when called with invalid credentials', () => {
          beforeEach(async () => {
            (updateCredentials as jest.Mock).mockRejectedValue(new Error('Rejected!'))
            await addAction({
              ...cliCommandArgs,
              input: {
                serviceType: 'newAdapter',
                authType: 'basic',
                login: true,
              },
              workspace,
            })
          })
          afterEach(() => {
            (updateCredentials as jest.Mock).mockResolvedValue(true)
          })

          it('should print login error', () => {
            expect(output.stderr.content).toContain('Could not login to newAdapter')
          })

          it('should print try again text', () => {
            expect(output.stderr.content).toContain('To try again run: `salto service add newAdapter`')
          })

          it('should not print login information updated', () => {
            expect(output.stdout.content).not.toContain('Login information successfully updated!')
          })

          it('should not print added', () => {
            expect(output.stdout.content).not.toContain('added to the environment')
          })
        })

        describe('no-login flag', () => {
          beforeEach(async () => {
            await addAction({
              ...cliCommandArgs,
              input: {
                serviceType: 'newAdapter',
                authType: 'basic',
                login: false,
              },
              workspace,
            })
          })
          it('should add without login', () => {
            expect(output.stdout.content).toContain('added to the environment')
            expect(output.stdout.content).not.toContain(
              'Please enter your Newadapter credentials:'
            )
          })
          it('should invoke the adapter install method', () => {
            expect(installAdapter).toHaveBeenCalled()
          })
        })

        describe('Environment flag', () => {
          const mockAddAdapter = addAdapter as jest.Mock
          beforeEach(async () => {
            mockAddAdapter.mockClear()
          })
          it('should use current env when env is not provided', async () => {
            await addAction({
              ...cliCommandArgs,
              input: {
                login: true,
                serviceType: 'hubspot',
                authType: 'basic',
              },
              workspace,
            })
            expect(workspace.setCurrentEnv).not.toHaveBeenCalled()
          })
          it('should use provided env', async () => {
            await addAction({
              ...cliCommandArgs,
              input: {
                login: true,
                serviceType: 'hubspot',
                authType: 'basic',
                env: mocks.withEnvironmentParam,
              },
              workspace,
            })
            expect(workspace.setCurrentEnv).toHaveBeenCalledWith(mocks.withEnvironmentParam, false)
          })
        })
      })

      describe('when called with a new adapter that does not exist', () => {
        describe('with login', () => {
          let errCode: CliExitCode
          beforeEach(async () => {
            errCode = await addAction({
              ...cliCommandArgs,
              input: {
                serviceType: 'noAdapter',
                authType: 'basic',
                login: true,
              },
              workspace,
            })
          })
          it('should return user input error', async () => {
            expect(errCode).toBe(CliExitCode.UserInputError)
          })
          it('should not print private accounts', async () => {
            expect(getPrivateAdaptersNames().some(privateName =>
              output.stdout.content.includes(privateName))).toBeFalsy()
          })
        })
        describe('without login', () => {
          let errCode: CliExitCode
          beforeEach(async () => {
            errCode = await addAction({
              ...cliCommandArgs,
              input: {
                serviceType: 'noAdapter',
                authType: 'basic',
                login: false,
              },
              workspace,
            })
          })
          it('should return user input error', async () => {
            expect(errCode).toBe(CliExitCode.UserInputError)
          })
          it('should not print private accounts', async () => {
            expect(getPrivateAdaptersNames().some(privateName =>
              output.stdout.content.includes(privateName))).toBeFalsy()
          })
        })
      })
    })
  })

  describe('login command', () => {
    let cliCommandArgs: mocks.MockCommandArgs
    beforeEach(() => {
      cliCommandArgs = mocks.mockCliCommandArgs('login', cliArgs)
    })
    beforeAll((() => {
      jest.spyOn(callbacks, 'getCredentialsFromUser').mockImplementation((obj: ObjectType) =>
        Promise.resolve(mockGetCredentialsFromUser(obj)))
    }))
    describe('when the workspace loads successfully', () => {
      describe('when called with already logged in account', () => {
        beforeEach(async () => {
          await loginAction({
            ...cliCommandArgs,
            input: {
              accountName: 'salesforce',
              authType: 'basic',
            },
            workspace,
          })
        })
        it('should print login override', () => {
          expect(output.stdout.content).toContain('override')
        })

        it('should get config from user', () => {
          expect(mockGetCredentialsFromUser).toHaveBeenCalled()
        })

        it('should call update config', () => {
          expect(updateCredentials).toHaveBeenCalled()
        })

        it('should print logged in', () => {
          expect(output.stdout.content).toContain('Login information successfully updated')
        })
      })

      describe('when called with not configured account', () => {
        beforeEach(async () => {
          await loginAction({
            ...cliCommandArgs,
            input: {
              accountName: 'notConfigured',
              authType: 'basic',
            },
            workspace,
          })
        })

        it('should print not configured', () => {
          expect(output.stderr.content).toContain('notConfigured is not configured in this environment')
        })
      })

      describe('when login called with unsupported auth type', () => {
        beforeEach(async () => {
          jest.spyOn(callbacks, 'getCredentialsFromUser').mockImplementation((obj: ObjectType) =>
            Promise.resolve(mockGetOAuthCredentialsFromUser(obj)))
          await loginAction({
            ...cliCommandArgs,
            input: {
              accountName: 'salesforce',
              authType: 'oauth',
            },
            workspace,
          })
        })

        it('fails with no such auth type error', () => {
          expect(output.stderr.content).toContain('Error: Could not login to salesforce: Adapter does not support authentication of type oauth')
        })
      })

      describe('when called with oauth credentials', () => {
        beforeEach(async () => {
          jest.spyOn(callbacks, 'getCredentialsFromUser').mockImplementation((obj: ObjectType) =>
            Promise.resolve(mockGetOAuthCredentialsFromUser(obj)))
          await loginAction({
            ...cliCommandArgs,
            input: {
              accountName: 'oauthAdapter',
              authType: 'oauth',
            },
            workspace,
          })
        })
        it('should process oauth credentials', () => {
          expect(processOauthCredentials).toHaveBeenCalled()
        })
        it('should get config from user', () => {
          expect(mockGetOAuthCredentialsFromUser).toHaveBeenCalled()
        })

        it('should call update config', () => {
          expect(updateCredentials).toHaveBeenCalled()
        })

        it('should print it logged in', () => {
          expect(output.stdout.content).toContain('Login information successfully updated')
        })
      })
      describe('when called with configured but not logged in account', () => {
        beforeEach(async () => {
          await loginAction({
            ...cliCommandArgs,
            input: {
              accountName: 'salesforce',
              authType: 'basic',
            },
            workspace,
          })
        })
        it('should get config from user', () => {
          expect(mockGetCredentialsFromUser).toHaveBeenCalled()
        })

        it('should call update config', () => {
          expect(updateCredentials).toHaveBeenCalled()
        })

        it('should print it logged in', () => {
          expect(output.stdout.content).toContain('Login information successfully updated')
        })
      })
      describe('Environment flag', () => {
        it('should use current env when env is not provided', async () => {
          await loginAction({
            ...cliCommandArgs,
            input: {
              accountName: 'salesforce',
              authType: 'basic',
            },
            workspace,
          })
          expect(workspace.setCurrentEnv).not.toHaveBeenCalled()
        })
        it('should use provided env', async () => {
          await loginAction({
            ...cliCommandArgs,
            input: {
              accountName: 'netsuite',
              authType: 'basic',
              env: mocks.withEnvironmentParam,
            },
            workspace,
          })
          expect(workspace.setCurrentEnv).toHaveBeenCalledWith(mocks.withEnvironmentParam, false)
        })
      })
      describe('when called with login parameters', () => {
        it('should succeed when called with valid parameters', async () => {
          const exitCode = await loginAction({
            ...cliCommandArgs,
            input: {
              accountName: 'salesforce',
              authType: 'basic',
              loginParameters: [
                'username=testUser',
                'password=testPassword',
                'token=testToken',
                'sandbox=y',
              ],
            },
            workspace,
          })
          expect(exitCode).toEqual(CliExitCode.Success)
        })
        it('should fail when called with missing parameter', async () => {
          const exitCode = await loginAction({
            ...cliCommandArgs,
            input: {
              accountName: 'salesforce',
              authType: 'basic',
              loginParameters: [
                'username=testUser',
                'password=testPassword',
                'token=testToken',
              ],
            },
            workspace,
          })
          expect(exitCode).toEqual(CliExitCode.AppError)
        })
        it('should fail when called with malformed parameter', async () => {
          const exitCode = await loginAction({
            ...cliCommandArgs,
            input: {
              accountName: 'salesforce',
              authType: 'basic',
              loginParameters: [
                'username=testUser',
                'password=testPassword',
                'testToken',
                'sandbox=y',
              ],
            },
            workspace,
          })
          expect(exitCode).toEqual(CliExitCode.AppError)
        })
      })
    })
  })
})
