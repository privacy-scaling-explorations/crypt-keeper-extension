import RPCAction from '@src/util/constants'
import { PendingRequestType, NewIdentityRequest, WalletInfo, WalletInfoBackgound, IdentityName } from '@src/types'
import { bigintToHex } from 'bigint-conversion'
//import { RLNFullProof } from 'rlnjs'
import Handler from './controllers/handler'
import LockService from './services/lock'
import IdentityService from './services/identity'
import MetamaskServiceEthers from './services/metamask-ethers';
import ZkValidator from './services/zk-validator'
import RequestManager from './controllers/request-manager'
import SemaphoreService from './services/protocols/semaphore'
//import RLNService from './services/protocols/rln'
import { RLNProofRequest, SemaphoreProof, SemaphoreProofRequest } from './services/protocols/interfaces'
import ApprovalService from './services/approval'
import ZkIdentityWrapper from './identity-decorater'
import identityFactory from './identity-factory'
import BrowserUtils from './controllers/browser-utils'
declare type Ethers = typeof import("ethers");

export default class ZkKeeperController extends Handler {
    private identityService: IdentityService
    private zkValidator: ZkValidator
    private requestManager: RequestManager
    private semaphoreService: SemaphoreService
    //private rlnService: RLNService
    private approvalService: ApprovalService
    constructor() {
        super()
        this.identityService = new IdentityService()
        this.zkValidator = new ZkValidator()
        this.requestManager = new RequestManager()
        this.semaphoreService = new SemaphoreService()
        //this.rlnService = new RLNService()
        this.approvalService = new ApprovalService()
        console.log("Inside ZkKepperController");
    }

    initialize = async (): Promise<ZkKeeperController> => {
        // common
        this.add(
            RPCAction.UNLOCK,
            LockService.unlock,
            //this.metamaskServiceEthers.ensure,
            this.identityService.unlock,
            this.approvalService.unlock,
            LockService.onUnlocked
        )

        this.add(RPCAction.LOCK, LockService.logout)

        /**
         *  Return status of background process
         *  @returns {Object} status Background process status
         *  @returns {boolean} status.initialized has background process been initialized
         *  @returns {boolean} status.unlocked is background process unlocked
         */
        this.add(RPCAction.GET_STATUS, async () => {
            const { initialized, unlocked } = await LockService.getStatus()
            return {
                initialized,
                unlocked
            }
        })

        // requests
        this.add(RPCAction.GET_PENDING_REQUESTS, LockService.ensure, this.requestManager.getRequests)
        this.add(RPCAction.FINALIZE_REQUEST, LockService.ensure, this.requestManager.finalizeRequest)

        console.log("3. Inside ZkKepperController() class");
        // web3
        //this.add(RPCAction.CONNECT_METAMASK, LockService.ensure, this.metamaskServiceEthers.connectMetamask)
        //this.add(RPCAction.GET_WALLET_INFO, this.metamaskServiceEthers.getWalletInfo)

        // lock
        this.add(RPCAction.SETUP_PASSWORD, (payload: string) => LockService.setupPassword(payload))

        // identites
        this.add(
            RPCAction.CREATE_IDENTITY,
            LockService.ensure,
            async (payload: NewIdentityRequest) => {
                try {
                    const { strategy, messageSignature, options } = payload
                    if (!strategy) throw new Error('strategy not provided')

                    const numOfIdentites = await this.identityService.getNumOfIdentites()
                    const config: any = {
                        ...options,
                        name: options?.name || `Account # ${numOfIdentites}`
                    }

                    if (strategy === 'interrep') {
                        console.log("CREATE_IDENTITY: 1")
                        config.messageSignature = messageSignature;
                        console.log("CREATE_IDENTITY: 2")
                    }

                    const identity: ZkIdentityWrapper | undefined = await identityFactory(strategy, config)
                    console.log("CREATE_IDENTITY: 4", identity);

                    if (!identity) {
                        throw new Error('Identity not created, make sure to check strategy')
                    }

                    await this.identityService.insert(identity)

                    return true
                } catch (error: any) {
                    console.log("CREATE_IDENTITY: Error", error);
                    throw new Error(error.message)
                }
            }
        )

        this.add(RPCAction.GET_COMMITMENTS, LockService.ensure, this.identityService.getIdentityCommitments)
        this.add(RPCAction.GET_IDENTITIES, LockService.ensure, this.identityService.getIdentities)
        this.add(RPCAction.SET_ACTIVE_IDENTITY, LockService.ensure, this.identityService.setActiveIdentity)
        this.add(RPCAction.SET_IDENTITY_NAME, LockService.ensure, async (payload: IdentityName) => await this.identityService.setIdentityName(payload))
        this.add(RPCAction.DELETE_IDENTITY, LockService.ensure, async (payload: IdentityName) => await this.identityService.deleteIdentity(payload))
        this.add(RPCAction.GET_ACTIVE_IDENTITY, LockService.ensure, async () => {
            const identity = await this.identityService.getActiveidentity()
            if (!identity) {
                return null
            }
            const identityCommitment: bigint = identity.genIdentityCommitment()
            const identityCommitmentHex = bigintToHex(identityCommitment)
            return identityCommitmentHex
        })

        // protocols
        this.add(
            RPCAction.SEMAPHORE_PROOF,
            LockService.ensure,
            this.zkValidator.validateZkInputs,
            async (payload: SemaphoreProofRequest, meta: any) => {
                const { unlocked } = await LockService.getStatus()

                if (!unlocked) {
                    await BrowserUtils.openPopup()
                    await LockService.awaitUnlock()
                }

                const identity: ZkIdentityWrapper | undefined = await this.identityService.getActiveidentity()
                const approved: boolean = await this.approvalService.isApproved(meta.origin)
                const perm: any = await this.approvalService.getPermission(meta.origin)

                if (!identity) throw new Error('active identity not found')
                if (!approved) throw new Error(`${meta.origin} is not approved`)

                try {
                    if (!perm.noApproval) {
                        await this.requestManager.newRequest(PendingRequestType.SEMAPHORE_PROOF, {
                            ...payload,
                            origin: meta.origin
                        })
                    }

                    await BrowserUtils.closePopup()

                    const proof: SemaphoreProof = await this.semaphoreService.genProof(identity.zkIdentity, payload)

                    return proof
                } catch (err) {
                    await BrowserUtils.closePopup()
                    throw err
                }
            }
        )

        this.add(
            RPCAction.RLN_PROOF,
            LockService.ensure,
            this.zkValidator.validateZkInputs,
            async (payload: RLNProofRequest) => {
                const identity: ZkIdentityWrapper | undefined = await this.identityService.getActiveidentity()
                if (!identity) throw new Error('active identity not found')

                //const proof: RLNFullProof = await this.rlnService.genProof(identity.zkIdentity, payload)
                //return proof
            }
        )

        // injecting
        this.add(RPCAction.TRY_INJECT, async (payload: any) => {
            const { origin }: { origin: string } = payload
            if (!origin) throw new Error('Origin not provided')

            const { unlocked } = await LockService.getStatus()

            if (!unlocked) {
                await BrowserUtils.openPopup()
                await LockService.awaitUnlock()
            }

            const includes: boolean = await this.approvalService.isApproved(origin)

            if (includes) return true

            try {
                await this.requestManager.newRequest(PendingRequestType.INJECT, { origin })
                return true
            } catch (e) {
                console.error(e)
                return false
            }
        })
        this.add(RPCAction.APPROVE_HOST, LockService.ensure, async (payload: any) => {
            this.approvalService.add(payload)
        })
        this.add(RPCAction.IS_HOST_APPROVED, LockService.ensure, this.approvalService.isApproved)
        this.add(RPCAction.REMOVE_HOST, LockService.ensure, this.approvalService.remove)

        this.add(RPCAction.GET_HOST_PERMISSIONS, LockService.ensure, async (payload: any) => this.approvalService.getPermission(payload))

        this.add(RPCAction.SET_HOST_PERMISSIONS, LockService.ensure, async (payload: any) => {
            const { host, ...permissions } = payload
            return this.approvalService.setPermission(host, permissions)
        })

        this.add(RPCAction.CLOSE_POPUP, async () => BrowserUtils.closePopup())

        // this.add(RPCAction.CREATE_IDENTITY_REQ, LockService.ensure, this.metamaskServiceEthers.ensure, async () => {
        //     const res: any = await this.requestManager.newRequest(PendingRequestType.CREATE_IDENTITY, { origin })

        //     const { provider, options } = res

        //     return this.handle({
        //         method: RPCAction.CREATE_IDENTITY,
        //         payload: {
        //             strategy: provider,
        //             options
        //         }
        //     })
        // })

        // dev
        this.add(RPCAction.CLEAR_APPROVED_HOSTS, this.approvalService.empty)
        this.add(RPCAction.DUMMY_REQUEST, async () =>
            this.requestManager.newRequest(PendingRequestType.DUMMY, 'hello from dummy')
        )

        return this
    }
}
