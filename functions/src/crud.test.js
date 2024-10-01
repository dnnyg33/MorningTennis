const test = require('firebase-functions-test')();
const crudFunctions = require('./crud');

describe('Approve set request', () => {
    it('when non-admin user tries to approve own submitted request, it should fail', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('You are not authorized to approve your own request');
    });
    it('when admin user tries to approve own submitted request, it should pass', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('Request approved successfully');
    });
    it('when admin user tries to approve another user\'s request, it should pass', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('Request approved successfully');
    });
    it('when non-admin/non-player user tries to approve another user\'s request, it should fail', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('You are not authorized to approve another user\'s request');
    });
    it('when winner tries to approved loser\'s request, it should pass', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('Request approved successfully');
    });
    it('when loser tries to approved winner\'s request, it should pass', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('Request approved successfully');
    })
    it('when winner tries to approve winner teammates request, it should fail', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('You are not authorized to approve another user\'s request');
    })
    it('when loser tries to approve loser teammates request, it should fail', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('You are not authorized to approve another user\'s request');
    })
    it('when user is authorized, and approve is true, verification is set', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('Request approved successfully');
    })
    it('when user is authorized and approve is false, contestation is set', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('Request approved successfully');
    })
    it('when set is submitted by admin, but user is player, it should pass', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('Request approved successfully');
    })
    it('when set is submitted by admin, but user is not player, it should fail', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('You are not authorized to approve another user\'s request');
    })
    it('if set is already approved, it should fail', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('Request already approved');
    })
    it('if set is already contested, it should fail', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('Request already contested');
    })
    it('if data is missing, it should fail', async () => {
        const wrapped = test.wrap(crudFunctions.approveSetRequest);
        const data = {

        };
        const result = await wrapped(data);
        expect(result).toEqual('Request data is missing');
    })

}
)