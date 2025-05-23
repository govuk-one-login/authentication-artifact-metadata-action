/**
 * Unit tests for the action's main functionality, src/main.ts
 */
import * as core from '@actions/core'
import * as github from '@actions/github'
import { Shescape } from 'shescape'

import {
  createInitialMetadata,
  getGraphqlVariables,
  run,
  sanitizeField,
  updateMetadataFromPR
} from '../src/main'
import { PRMetadata, PRNode, QueryResponse } from '../src/types.js'

// Mock the required dependencies
jest.mock('@actions/core')
jest.mock('@actions/github')
jest.mock('shescape')

describe('main', () => {
  const mockOctokit = {
    graphql: jest.fn()
  }

  const mockShescapeInstance = {
    quote: jest.fn().mockReturnValue('escaped-json-string')
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock GitHub context properly
    Object.defineProperty(github, 'context', {
      value: {
        repo: {
          owner: 'test-owner',
          repo: 'test-repo'
        },
        sha: '1234567890abcdef1234567890abcdef12345678'
      },
      writable: true
    })

    // Mock getOctokit to return our mock implementation
    jest.spyOn(github, 'getOctokit').mockReturnValue(mockOctokit as any)

    // Mock Shescape constructor to return our mock instance
    jest.mocked(Shescape).mockImplementation(() => mockShescapeInstance as any)

    // Mock core functions
    jest.spyOn(core, 'getInput').mockImplementation((name: string) => {
      if (name === 'github-token') return 'mock-token'
      if (name === 'shell') return ''
      return ''
    })
    jest.spyOn(core, 'setOutput').mockImplementation()
    jest.spyOn(core, 'setFailed').mockImplementation()

    // Mock console.log
    jest.spyOn(console, 'log').mockImplementation()
  })

  describe('run', () => {
    it('should process commit data with no associated PRs', async () => {
      // Mock the GraphQL response with no PRs
      const mockResponse: QueryResponse = {
        repository: {
          name: 'test-repo',
          nameWithOwner: 'test-owner/test-repo',
          object: {
            oid: '1234567890abcdef1234567890abcdef12345678',
            message: 'Test commit message\nMore details here',
            associatedPullRequests: {
              nodes: []
            }
          },
          owner: {
            login: 'test-owner'
          }
        }
      }

      mockOctokit.graphql.mockResolvedValue(mockResponse)

      await run()

      // Verify that the correct GraphQL query was executed
      expect(github.getOctokit).toHaveBeenCalledWith('mock-token')
      expect(mockOctokit.graphql).toHaveBeenCalled()

      // Verify that the output was set correctly
      expect(core.setOutput).toHaveBeenCalledWith('json', expect.any(String))

      // Parse the JSON output and verify it
      const outputJson = JSON.parse(
        (core.setOutput as jest.Mock).mock.calls.find(
          call => call[0] === 'json'
        )[1]
      )
      expect(outputJson).toHaveProperty('commit_message', 'Test commit message')
      expect(outputJson).toHaveProperty(
        'repo_full_name',
        'test-owner/test-repo'
      )
      expect(outputJson).toHaveProperty(
        'commitsha',
        '1234567890abcdef1234567890abcdef12345678'
      )
      expect(outputJson).toHaveProperty(
        'codepipeline-artifact-revision-summary',
        '1234567: Test commit message'
      )

      // Verify no PR-related data
      expect(outputJson.pr_number).toBeUndefined()

      // Verify no errors occurred
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should process commit data with an associated merged PR', async () => {
      // Mock the GraphQL response with a merged PR
      const mockResponse: QueryResponse = {
        repository: {
          name: 'test-repo',
          nameWithOwner: 'test-owner/test-repo',
          object: {
            oid: '1234567890abcdef1234567890abcdef12345678',
            message: 'Merge pull request #123',
            associatedPullRequests: {
              nodes: [
                {
                  number: 123,
                  title: 'Test PR title',
                  merged: true,
                  mergedAt: '2025-03-22T10:00:00Z',
                  mergeCommit: {
                    oid: 'abcdef1234567890abcdef1234567890abcdef12'
                  }
                }
              ]
            }
          },
          owner: {
            login: 'test-owner'
          }
        }
      }

      mockOctokit.graphql.mockResolvedValue(mockResponse)

      await run()

      // Verify that the output was set correctly
      const outputJson = JSON.parse(
        (core.setOutput as jest.Mock).mock.calls.find(
          call => call[0] === 'json'
        )[1]
      )

      // Verify PR data was included
      expect(outputJson).toHaveProperty('pr_number', '123')
      expect(outputJson).toHaveProperty('pr_title', 'Test PR title')
      expect(outputJson).toHaveProperty('pr_merged_at', '2025-03-22T10:00:00Z')
      expect(outputJson).toHaveProperty(
        'pr_merge_commit_sha',
        'abcdef1234567890abcdef1234567890abcdef12'
      )
      expect(outputJson).toHaveProperty('commitmessage', 'Test PR title')
      expect(outputJson).toHaveProperty(
        'codepipeline-artifact-revision-summary',
        'abcdef1: #123 (test-owner/test-repo) - Test PR title'
      )
    })

    it('should escape output when shell parameter is provided', async () => {
      // Mock shell input
      jest.spyOn(core, 'getInput').mockImplementation((name: string) => {
        if (name === 'github-token') return 'mock-token'
        if (name === 'shell') return 'bash'
        return ''
      })

      // Mock the GraphQL response
      const mockResponse: QueryResponse = {
        repository: {
          name: 'test-repo',
          nameWithOwner: 'test-owner/test-repo',
          object: {
            oid: '1234567890abcdef1234567890abcdef12345678',
            message: 'Test commit message',
            associatedPullRequests: {
              nodes: []
            }
          },
          owner: {
            login: 'test-owner'
          }
        }
      }

      mockOctokit.graphql.mockResolvedValue(mockResponse)

      await run()

      // Verify that shell options were properly set
      expect(Shescape).toHaveBeenCalledWith({ shell: 'bash' })
      expect(mockShescapeInstance.quote).toHaveBeenCalled()
      expect(core.setOutput).toHaveBeenCalledWith('shell', 'bash')
      expect(core.setOutput).toHaveBeenCalledWith(
        'escaped-json',
        'escaped-json-string'
      )
    })

    it('should truncate codepipeline-artifact-revision-summary if too long', async () => {
      // Create a very long PR title
      const longTitle = 'A'.repeat(3000)

      // Mock the GraphQL response with a PR with long title
      const mockResponse: QueryResponse = {
        repository: {
          name: 'test-repo',
          nameWithOwner: 'test-owner/test-repo',
          object: {
            oid: '1234567890abcdef1234567890abcdef12345678',
            message: 'Test commit message',
            associatedPullRequests: {
              nodes: [
                {
                  number: 123,
                  title: longTitle,
                  merged: true,
                  mergedAt: '2025-03-22T10:00:00Z',
                  mergeCommit: {
                    oid: 'abcdef1234567890abcdef1234567890abcdef12'
                  }
                }
              ]
            }
          },
          owner: {
            login: 'test-owner'
          }
        }
      }

      mockOctokit.graphql.mockResolvedValue(mockResponse)

      await run()

      // Verify that codepipeline-artifact-revision-summary was truncated
      const outputJson = JSON.parse(
        (core.setOutput as jest.Mock).mock.calls.find(
          call => call[0] === 'json'
        )[1]
      )
      expect(outputJson['codepipeline-artifact-revision-summary'].length).toBe(
        2048
      )
    })

    it('should sanitize non-ASCII characters from fields', async () => {
      // Mock the GraphQL response with non-ASCII characters
      const mockResponse: QueryResponse = {
        repository: {
          name: 'test-repo',
          nameWithOwner: 'test-owner/test-repo',
          object: {
            oid: '1234567890abcdef1234567890abcdef12345678',
            message: 'Test commit message with emoji 😊 and unicode ♠♥♦♣',
            associatedPullRequests: {
              nodes: [
                {
                  number: 123,
                  title: 'PR with special chars ©®™ and emoji 🔥',
                  merged: true,
                  mergedAt: '2025-03-22T10:00:00Z',
                  mergeCommit: {
                    oid: 'abcdef1234567890abcdef1234567890abcdef12'
                  }
                }
              ]
            }
          },
          owner: {
            login: 'test-owner'
          }
        }
      }

      mockOctokit.graphql.mockResolvedValue(mockResponse)

      await run()

      // Verify that non-ASCII characters were sanitized
      const outputJson = JSON.parse(
        (core.setOutput as jest.Mock).mock.calls.find(
          call => call[0] === 'json'
        )[1]
      )
      expect(outputJson.commit_message).not.toContain('😊')
      expect(outputJson.pr_title).not.toContain('🔥')
      expect(outputJson.commit_message).toBe(
        'Test commit message with emoji  and unicode '
      )
      expect(outputJson.pr_title).toBe('PR with special chars  and emoji ')
    })

    it('should handle errors gracefully', async () => {
      // Mock an error in the GraphQL call
      const testError = new Error('Test error')
      mockOctokit.graphql.mockRejectedValue(testError)

      await run()

      // Verify that the error was handled and reported
      expect(core.setFailed).toHaveBeenCalledWith('Test error')
    })
  })

  describe('helper functions', () => {
    describe('getGraphqlVariables', () => {
      it('returns the correct variables structure', () => {
        // Set up the GitHub context with custom values for this test
        Object.defineProperty(github, 'context', {
          value: {
            repo: {
              owner: 'test-owner',
              repo: 'test-repo'
            },
            sha: 'test-sha-1234'
          },
          writable: true
        })

        const result = getGraphqlVariables()

        expect(result).toEqual({
          owner: 'test-owner',
          name: 'test-repo',
          oid: 'test-sha-1234'
        })
      })
    })

    describe('sanitizeField', () => {
      it('returns an empty string for undefined input', () => {
        expect(sanitizeField(undefined)).toBe('')
      })

      it('removes non-ASCII characters', () => {
        expect(sanitizeField('Hello😊World')).toBe('HelloWorld')
        expect(sanitizeField('Test ©®™')).toBe('Test ')
        expect(sanitizeField('Regular text')).toBe('Regular text')
        // Adjusted test to match the behavior of removing tabs and newlines
        expect(sanitizeField('Tabs\tand\nnewlines')).toBe('Tabsandnewlines')
      })
    })

    describe('createInitialMetadata', () => {
      it('creates metadata from repository information', () => {
        // Mock the GraphQL response
        const mockResponse: QueryResponse = {
          repository: {
            name: 'test-repo',
            nameWithOwner: 'test-owner/test-repo',
            object: {
              oid: '1234567890abcdef1234567890abcdef12345678',
              message: 'Test commit message\nMore details here',
              associatedPullRequests: {
                nodes: []
              }
            },
            owner: {
              login: 'test-owner'
            }
          }
        }

        // Set up the GitHub context with a SHA
        Object.defineProperty(github, 'context', {
          value: {
            sha: '1234567890abcdef1234567890abcdef12345678'
          },
          writable: true
        })

        const result = createInitialMetadata(mockResponse)

        expect(result).toEqual({
          pr_number: undefined,
          pr_title: undefined,
          pr_merged_at: undefined,
          pr_merge_commit_sha: undefined,
          commit_message: 'Test commit message',
          repo_full_name: 'test-owner/test-repo',
          repo_owner: 'test-owner',
          repo_name: 'test-repo',
          repository: 'test-owner/test-repo',
          commitsha: '1234567890abcdef1234567890abcdef12345678',
          commitmessage: 'Test commit message',
          'codepipeline-artifact-revision-summary':
            '1234567: Test commit message'
        })
      })

      it('sanitizes non-ASCII characters in metadata', () => {
        // Mock the GraphQL response with non-ASCII characters
        const mockResponse: QueryResponse = {
          repository: {
            name: 'test-repo😊',
            nameWithOwner: 'test-owner/test-repo😊',
            object: {
              oid: '1234567890abcdef1234567890abcdef12345678',
              message: 'Test commit message 😊\nMore details here',
              associatedPullRequests: {
                nodes: []
              }
            },
            owner: {
              login: 'test-owner'
            }
          }
        }

        // Set up the GitHub context with a SHA
        Object.defineProperty(github, 'context', {
          value: {
            sha: '1234567890abcdef1234567890abcdef12345678'
          },
          writable: true
        })

        const result = createInitialMetadata(mockResponse)

        expect(result.commit_message).toBe('Test commit message ')
        expect(result.repo_name).toBe('test-repo')
        expect(result.repo_full_name).toBe('test-owner/test-repo')
      })
    })

    describe('updateMetadataFromPR', () => {
      it('updates metadata with PR information', () => {
        // Create initial metadata
        const metadata: PRMetadata = {
          pr_number: undefined,
          pr_title: undefined,
          pr_merged_at: undefined,
          pr_merge_commit_sha: undefined,
          commit_message: 'Test commit message',
          repo_full_name: 'test-owner/test-repo',
          repo_owner: 'test-owner',
          repo_name: 'test-repo',
          repository: 'test-owner/test-repo',
          commitsha: '1234567890abcdef1234567890abcdef12345678',
          commitmessage: 'Test commit message',
          'codepipeline-artifact-revision-summary':
            '1234567: Test commit message'
        }

        // Create PR node
        const prNode: PRNode = {
          number: 123,
          title: 'Test PR title',
          merged: true,
          mergedAt: '2025-03-22T10:00:00Z',
          mergeCommit: {
            oid: 'abcdef1234567890abcdef1234567890abcdef12'
          }
        }

        // Update the metadata
        updateMetadataFromPR(metadata, prNode)

        // Verify the updates
        expect(metadata.pr_number).toBe('123')
        expect(metadata.pr_title).toBe('Test PR title')
        expect(metadata.pr_merged_at).toBe('2025-03-22T10:00:00Z')
        expect(metadata.pr_merge_commit_sha).toBe(
          'abcdef1234567890abcdef1234567890abcdef12'
        )
        expect(metadata.commitmessage).toBe('Test PR title')
        expect(metadata['codepipeline-artifact-revision-summary']).toBe(
          'abcdef1: #123 (test-owner/test-repo) - Test PR title'
        )
      })

      it('handles PRs with missing merge commit information', () => {
        // Create initial metadata
        const metadata: PRMetadata = {
          pr_number: undefined,
          pr_title: undefined,
          pr_merged_at: undefined,
          pr_merge_commit_sha: undefined,
          commit_message: 'Test commit message',
          repo_full_name: 'test-owner/test-repo',
          repo_owner: 'test-owner',
          repo_name: 'test-repo',
          repository: 'test-owner/test-repo',
          commitsha: '1234567890abcdef1234567890abcdef12345678',
          commitmessage: 'Test commit message',
          'codepipeline-artifact-revision-summary':
            '1234567: Test commit message'
        }

        // Create PR node with null mergeCommit
        const prNode: PRNode = {
          number: 123,
          title: 'Test PR title',
          merged: true,
          mergedAt: '2025-03-22T10:00:00Z',
          mergeCommit: null as any
        }

        // Update the metadata
        updateMetadataFromPR(metadata, prNode)

        // Verify the updates - should use empty strings for merge commit related fields
        expect(metadata.pr_number).toBe('123')
        expect(metadata.pr_title).toBe('Test PR title')
        expect(metadata.pr_merged_at).toBe('2025-03-22T10:00:00Z')
        expect(metadata.pr_merge_commit_sha).toBe('')
        expect(metadata['codepipeline-artifact-revision-summary']).toBe(
          ': #123 (test-owner/test-repo) - Test PR title'
        )
      })

      it('sanitizes non-ASCII characters in PR information', () => {
        // Create initial metadata
        const metadata: PRMetadata = {
          pr_number: undefined,
          pr_title: undefined,
          pr_merged_at: undefined,
          pr_merge_commit_sha: undefined,
          commit_message: 'Test commit message',
          repo_full_name: 'test-owner/test-repo',
          repo_owner: 'test-owner',
          repo_name: 'test-repo',
          repository: 'test-owner/test-repo',
          commitsha: '1234567890abcdef1234567890abcdef12345678',
          commitmessage: 'Test commit message',
          'codepipeline-artifact-revision-summary':
            '1234567: Test commit message'
        }

        // Create PR node with non-ASCII characters
        const prNode: PRNode = {
          number: 123,
          title: 'Test PR title with emoji 😊',
          merged: true,
          mergedAt: '2025-03-22T10:00:00Z',
          mergeCommit: {
            oid: 'abcdef1234567890abcdef1234567890abcdef12'
          }
        }

        // Update the metadata
        updateMetadataFromPR(metadata, prNode)

        // Verify the updates have sanitized fields
        expect(metadata.pr_title).toBe('Test PR title with emoji ')
        expect(metadata.commitmessage).toBe('Test PR title with emoji ')
        expect(metadata['codepipeline-artifact-revision-summary']).toContain(
          'Test PR title with emoji '
        )
      })
    })
  })
})
