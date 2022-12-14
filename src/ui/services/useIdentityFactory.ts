import { CreateIdentityWeb2Provider } from "@src/types";
import { useMetaMaskWalletInfo } from "./useMetaMask";

export async function useIdentityFactory(web2Provider: CreateIdentityWeb2Provider, nonce: number): Promise<string | undefined> {
    const walletInfo = await useMetaMaskWalletInfo();
    
    return await walletInfo?.signer.signMessage(`Sign this message to generate your ${web2Provider} Semaphore identity with key nonce: ${nonce}.`)
}
