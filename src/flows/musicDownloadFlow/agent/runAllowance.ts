/**
 * Whether the user has told Claude, in this conversation, to go ahead with downloads without asking each time.
 * It lives only as long as the conversation: a new one (`/new`), a reopened one and a new launch all start without
 * it, because "yes" to one request is not "yes" to the next conversation.
 */
export const runAllowance = {
    downloads: false,
    reset(): void {
        this.downloads = false;
    },
};
